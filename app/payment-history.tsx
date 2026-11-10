import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator, Alert, Platform, Pressable, SafeAreaView,
    ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';

type Payment = {
    id: string;
    amount: number;
    method: string;
    paid_at: string;
    notes: string | null;
};
type Job = {
    id: string;
    customer_name: string;
    service: string;
    final_price: number | null;
    amount_paid: number | null;
};

const methods = ['Cash', 'Card', 'Zelle', 'Venmo', 'Check', 'Other'];
const money = (value: number) => '$' + value.toFixed(2);
const today = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
};

function message(title: string, detail: string) {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(`${title}\n\n${detail}`);
    } else {
        Alert.alert(title, detail);
    }
}

export default function PaymentHistoryScreen() {
    const params = useLocalSearchParams<{ id?: string | string[] }>();
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    const [job, setJob] = useState<Job | null>(null);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savingPrice, setSavingPrice] = useState(false);
    const [error, setError] = useState('');
    const [feedback, setFeedback] = useState('');
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState('Cash');
    const [notes, setNotes] = useState('');
    const [date, setDate] = useState(today());
    const [priceInput, setPriceInput] = useState('');

    const load = useCallback(async (showSpinner = true) => {
        if (showSpinner) setLoading(true);
        setError('');
        try {
            const { data: auth, error: authError } = await supabase.auth.getUser();
            if (authError) throw authError;
            if (!auth.user) {
                router.replace('/owner-login');
                return;
            }
            const { data: owner, error: ownerError } = await supabase
                .from('rrallc_owners').select('user_id')
                .eq('user_id', auth.user.id).maybeSingle();
            if (ownerError) throw ownerError;
            if (!owner) {
                setJob(null);
                throw new Error('This account is not authorized to manage payments.');
            }
            if (!id) throw new Error('Missing job ID. Open this page from Owner Dashboard.');
            const [j, p] = await Promise.all([
                supabase.from('quote_requests')
                    .select('id,customer_name,service,final_price,amount_paid')
                    .eq('id', id).single(),
                supabase.from('payment_transactions')
                    .select('id,amount,method,paid_at,notes')
                    .eq('quote_request_id', id).order('paid_at', { ascending: false }),
            ]);
            if (j.error) throw j.error;
            if (p.error) throw p.error;
            const loadedJob = j.data as Job;
            setJob(loadedJob);
            setPriceInput(loadedJob.final_price == null ? '' : String(loadedJob.final_price));
            setPayments((p.data ?? []) as Payment[]);
        } catch (e: any) {
            setError(e?.message ?? 'Unable to load job payments.');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { void load(); }, [load]);

    const paid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const finalPrice = job?.final_price == null ? null : Number(job.final_price);
    const balance = finalPrice == null ? null : Math.max(0, finalPrice - paid);

    async function savePrice() {
        if (!job || savingPrice) return;
        const raw = priceInput.trim();
        const n = Number(raw);
        if (!/^\d+(\.\d{1,2})?$/.test(raw) || !Number.isFinite(n) || n <= 0) {
            setFeedback('Enter a valid final price greater than $0 (up to two decimal places).');
            return;
        }
        if (n < paid) {
            setFeedback(`Final price cannot be less than payments already recorded (${money(paid)}).`);
            return;
        }
        setSavingPrice(true);
        setFeedback('');
        try {
            const { data, error: updateError } = await supabase
                .from('quote_requests').update({ final_price: n })
                .eq('id', job.id).select('id').single();
            if (updateError) throw updateError;
            if (!data) throw new Error('Final price was not updated.');
            await load(false);
            setFeedback(`Final price saved: ${money(n)}.`);
        } catch (e: any) {
            const detail = e?.message ?? 'Unable to save final price.';
            setFeedback(detail);
            message('Final price not saved', detail);
        } finally {
            setSavingPrice(false);
        }
    }

    async function addPayment() {
        if (saving) return;
        setFeedback('');
        if (!job) { setFeedback('Select a job from Owner Dashboard first.'); return; }
        if (finalPrice == null) {
            setFeedback('Set and save the final job price before recording a payment.');
            return;
        }
        const raw = amount.trim();
        const n = Number(raw);
        if (!/^\d+(\.\d{1,2})?$/.test(raw) || !Number.isFinite(n) || n <= 0) {
            setFeedback('Enter a valid payment amount greater than $0 (up to two decimal places).');
            return;
        }
        if (Math.round(n * 100) > Math.round((balance ?? 0) * 100)) {
            setFeedback(`Payment exceeds the remaining balance of ${money(balance ?? 0)}.`);
            return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            setFeedback('Enter a date in YYYY-MM-DD format.');
            return;
        }
        const paidAt = new Date(`${date}T12:00:00Z`);
        if (Number.isNaN(paidAt.getTime()) || paidAt.toISOString().slice(0, 10) !== date) {
            setFeedback('Enter a valid calendar date.');
            return;
        }
        setSaving(true);
        try {
            const { error: paymentError } = await supabase.rpc('record_job_payment', {
                p_quote_id: job.id,
                p_amount: n,
                p_method: method,
                p_paid_at: paidAt.toISOString(),
                p_notes: notes.trim(),
            });
            if (paymentError) throw paymentError;
            setAmount('');
            setNotes('');
            await load(false);
            setFeedback(`Payment of ${money(n)} recorded successfully.`);
            message('Payment recorded', `${money(n)} received by ${method}.`);
        } catch (e: any) {
            const detail = e?.message ?? 'Unknown database error.';
            setFeedback(`Payment not saved: ${detail}`);
            message('Payment not saved', detail);
        } finally {
            setSaving(false);
        }
    }

    if (loading && !job) {
        return (
            <View style= { s.center } >
            <ActivityIndicator color="#38bdf8" size = "large" />
                <Text style={ s.text }> Loading job…</Text>
                    </View>
    );
    }

    if (!job) {
        return (
            <SafeAreaView style= { s.safe } >
            <View style={ s.content }>
                <Text style={ s.title }> Job Payment </Text>
                    <Text style = { s.error } > { error || 'Job unavailable'}</Text> 
   
        < Pressable onPress = {() => void load()
} style = { s.button } >
    <Text style={ s.buttonText }> Retry </Text>
        </Pressable>
        < Pressable onPress = {() => router.push('/owner-dashboard')}>
            <Text style={ s.link }> Back to Owner Dashboard </Text>
                </Pressable>
                </View>
                </SafeAreaView>
    );
  }

return (
    <SafeAreaView style= { s.safe } >
    <ScrollView contentContainerStyle={ s.content } keyboardShouldPersistTaps = "handled" >
        <Pressable onPress={ () => router.push('/owner-dashboard') }>
            <Text style={ s.link }>‹ Owner Dashboard </Text>
                </Pressable>
                < Text style = { s.title } > Job Payment </Text>
                    < Text style = { s.text } > { job.customer_name } · { job.service } </Text>

                        < View style = { s.card } >
                            <Text style={ s.heading }> Job Balance </Text>
                                < Text style = { s.text } > Final price: { finalPrice == null ? 'Not set' : money(finalPrice) } </Text>
                                    < Text style = { s.text } > Recorded transactions: { money(paid) } </Text>
                                        < Text style = { s.text } > Balance: { balance == null ? 'Not set' : money(balance) } </Text>
                                            </View>

{
    finalPrice == null && (
        <View style={ s.card }>
            <Text style={ s.heading }> Set Final Job Price </Text>
                < Text style = { s.text } > A final price is required before recording a payment.</Text>
                    < TextInput style = { s.input } value = { priceInput } onChangeText = { setPriceInput }
    keyboardType = "decimal-pad" placeholder = "180.00" placeholderTextColor = "#94a3b8" />
        <Pressable style={ [s.button, savingPrice && s.disabled] } disabled = { savingPrice }
    onPress = {() => void savePrice()
}>
    <Text style={ s.buttonText }> { savingPrice? 'Saving price…': 'Save Final Price' } </Text>
        </Pressable>
        </View>
        )}

<View style={ s.card }>
    <Text style={ s.heading }> Record a Payment </Text>
        < Text style = { s.text } > Amount($) </Text>
            < TextInput style = { s.input } keyboardType = "decimal-pad" placeholder = "50.00"
placeholderTextColor = "#94a3b8" value = { amount } onChangeText = { setAmount } />
    <Text style={ s.text }> Payment date(YYYY - MM - DD) </Text>
        < TextInput style = { s.input } value = { date } onChangeText = { setDate } autoCapitalize = "none" />
            <Text style={ s.text }> Method </Text>
                < View style = { s.wrap } >
                {
                    methods.map(m => (
                        <Pressable key= { m } style = { [s.chip, method === m && s.selected]}
                onPress = {() => setMethod(m)} >
                    <Text style={ s.text }> { m } </Text>
                        </Pressable>
            ))}
</View>
    < Text style = { s.text } > Notes(optional) </Text>
        < TextInput style = { s.input } value = { notes } onChangeText = { setNotes }
placeholder = "Deposit or final payment" placeholderTextColor = "#94a3b8" />
    <Pressable style={ [s.button, saving && s.disabled] } disabled = { saving }
onPress = {() => void addPayment()}>
    <Text style={ s.buttonText }> { saving? 'Saving…': 'Record Payment' } </Text>
        </Pressable>
{ !!feedback && <Text accessibilityRole="alert" style = { s.feedback } > { feedback } </Text> }
</View>

    < View style = { s.sectionRow } >
        <Text style={ s.heading }> Transactions({ payments.length }) </Text>
            < Pressable onPress = {() => void load(false)}>
                <Text style={ s.link }> Refresh </Text>
                    </Pressable>
                    </View>
{
    payments.length === 0 ? (
        <Text style= { s.text } > No payments recorded.</Text>
        ) : payments.map(p => (
            <View key= { p.id } style = { s.card } >
            <Text style={ s.heading } > { money(Number(p.amount))
} · { p.method } </Text>
    < Text style = { s.text } > { new Date(p.paid_at).toLocaleDateString('en-US') } </Text>
{ !!p.notes && <Text style={ s.text }> { p.notes } </Text> }
</View>
        ))}

<Pressable style={ s.button } onPress = {() => router.push({
    pathname: '/job-invoice', params: { id: job.id },
})}>
    <Text style={ s.buttonText }> Invoice & amp; Receipt </Text>
        </Pressable>
{ !!error && <Text style={ s.error }> { error } </Text> }
</ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#0b1220' },
    center: { flex: 1, backgroundColor: '#0b1220', justifyContent: 'center', alignItems: 'center' },
    content: { padding: 20, paddingBottom: 60 },
    title: { color: 'white', fontSize: 28, fontWeight: '900', marginTop: 22, marginBottom: 14 },
    heading: { color: 'white', fontSize: 18, fontWeight: '800', marginBottom: 10 },
    text: { color: '#cbd5e1', marginVertical: 6 },
    link: { color: '#38bdf8', fontWeight: '700', marginVertical: 10 },
    card: { backgroundColor: '#172033', padding: 18, borderRadius: 12, marginTop: 14 },
    input: { backgroundColor: '#0b1220', borderWidth: 1, borderColor: '#475569', color: 'white', borderRadius: 8, padding: 12, marginBottom: 10 },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    chip: { borderColor: '#475569', borderWidth: 1, padding: 10, borderRadius: 8 },
    selected: { backgroundColor: '#0369a1' },
    button: { backgroundColor: '#0284c7', padding: 16, alignItems: 'center', borderRadius: 10, marginTop: 15 },
    buttonText: { color: 'white', fontWeight: '800' },
    disabled: { opacity: 0.55 },
    feedback: { color: '#fbbf24', marginTop: 12, fontWeight: '700' },
    error: { color: '#f87171', marginTop: 12 },
    sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 },
});
