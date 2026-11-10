import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator, Alert, Platform, Pressable, SafeAreaView, ScrollView,
    StyleSheet, Text, TextInput, View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';

const NAVY = '#142B3F';
const TEAL = '#147D7C';
const MUTED = '#617385';
const money = (n: number) => `$${n.toFixed(2)}`;
const asNumber = (v: unknown) => {
    const n = typeof v === 'number' ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
};

type Job = {
    id: string;
    customer_name: string | null;
    service: string | null;
    city: string | null;
    status: string | null;
    estimated_price: number | null;
    final_price: number | null;
    amount_paid: number | null;
    payment_status: string | null;
};
type Payment = {
    id?: string;
    quote_request_id: string;
    amount: number;
    method: string | null;
    paid_at: string | null;
};
const METHODS = ['Cash', 'Card', 'Zelle', 'Venmo', 'Cash App', 'Check', 'Other'];

function message(title: string, body: string) {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(`${title}\n\n${body}`);
    else Alert.alert(title, body);
}

export default function JobPaymentScreen() {
    const params = useLocalSearchParams<{ id?: string | string[]; quoteId?: string | string[]; jobId?: string | string[] }>();
    const routeId = [params.id, params.quoteId, params.jobId]
        .map((v) => Array.isArray(v) ? v[0] : v)
        .find((v) => typeof v === 'string' && v.length > 0);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [jobId, setJobId] = useState<string | null>(routeId ?? null);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [authorized, setAuthorized] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState('Cash');
    const [showJobs, setShowJobs] = useState(!routeId);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const { data: auth, error: authError } = await supabase.auth.getUser();
            if (authError || !auth.user) {
                setAuthorized(false);
                setError('Please sign in as an owner to manage payments.');
                return;
            }
            const { data: owner, error: ownerError } = await supabase
                .from('rrallc_owners').select('user_id').eq('user_id', auth.user.id).maybeSingle();
            if (ownerError) throw ownerError;
            if (!owner) {
                setAuthorized(false);
                setError('This account is not authorized to manage payments.');
                return;
            }
            setAuthorized(true);
            const { data: jobRows, error: jobError } = await supabase
                .from('quote_requests')
                .select('id,customer_name,service,city,status,estimated_price,final_price,amount_paid,payment_status')
                .order('created_at', { ascending: false });
            if (jobError) throw jobError;
            const list = (jobRows ?? []) as Job[];
            setJobs(list);
            const selectedId = jobId ?? routeId;
            if (selectedId) {
                const { data: transactionRows, error: paymentError } = await supabase
                    .from('payment_transactions')
                    .select('quote_request_id,amount,method,paid_at')
                    .eq('quote_request_id', selectedId)
                    .order('paid_at', { ascending: false });
                if (paymentError) throw paymentError;
                setPayments((transactionRows ?? []) as Payment[]);
            } else {
                setPayments([]);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to load payment information.');
        } finally {
            setLoading(false);
        }
    }, [jobId, routeId]);

    useEffect(() => { void load(); }, [load]);

    const job = useMemo(() => jobs.find((j) => j.id === jobId), [jobs, jobId]);
    const total = job ? Math.max(0, asNumber(job.final_price ?? job.estimated_price)) : 0;
    const transactionTotal = payments.reduce((sum, p) => sum + asNumber(p.amount), 0);
    // Older jobs may have a legacy amount_paid but no transaction rows.
    // Using the larger figure avoids counting the same payment twice.
    const paid = job ? Math.max(transactionTotal, asNumber(job.amount_paid)) : 0;
    const balance = Math.max(0, total - paid);

    const recordPayment = async () => {
        if (!job || saving) return;
        const value = Number(amount.trim());
        if (!Number.isFinite(value) || value <= 0 || !/^\d+(\.\d{1,2})?$/.test(amount.trim())) {
            message('Invalid amount', 'Enter a positive payment amount with no more than two decimal places.');
            return;
        }
        if (value > balance + 0.001) {
            message('Amount too high', `The remaining balance is ${money(balance)}.`);
            return;
        }
        setSaving(true);
        try {
            // Refresh balance before saving to reduce accidental overpayments.
            const { data: freshJob, error: freshError } = await supabase
                .from('quote_requests').select('final_price,estimated_price,amount_paid').eq('id', job.id).single();
            if (freshError) throw freshError;
            const { data: freshPayments, error: paymentsError } = await supabase
                .from('payment_transactions').select('amount').eq('quote_request_id', job.id);
            if (paymentsError) throw paymentsError;
            const freshTotal = Math.max(0, asNumber(freshJob.final_price ?? freshJob.estimated_price));
            const freshPaid = Math.max(asNumber(freshJob.amount_paid), (freshPayments ?? []).reduce((s, p) => s + asNumber(p.amount), 0));
            if (value > Math.max(0, freshTotal - freshPaid) + 0.001) {
                throw new Error('The remaining balance changed. Refresh and try again.');
            }
            const { error: insertError } = await supabase.from('payment_transactions').insert({
                quote_request_id: job.id,
                amount: value,
                method,
                paid_at: new Date().toISOString(),
            });
            if (insertError) throw insertError;
            // The transaction is the source of truth. We intentionally do not update
            // quote_requests.amount_paid here because a DB trigger may already do that;
            // writing both independently risks duplication or inconsistent totals.
            setAmount('');
            await load();
            message('Payment recorded', `${money(value)} recorded for ${job.customer_name || 'this job'}.`);
        } catch (e) {
            message('Payment not recorded', e instanceof Error ? e.message : 'Please try again.');
        } finally {
            setSaving(false);
        }
    };

    const selectJob = (id: string) => {
        setJobId(id);
        setAmount('');
        setShowJobs(false);
    };

    return (
        <SafeAreaView style= { styles.safe } >
        <ScrollView contentContainerStyle={ styles.content } keyboardShouldPersistTaps = "handled" >
            <View style={ styles.topRow }>
                <Pressable onPress={ () => router.back() } style = { styles.back } >
                    <Ionicons name="arrow-back" size = { 20} color = { NAVY } />
                        <Text style={ styles.backText }> Back </Text>
                            </Pressable>
                            <View Pressable onPress = {() => void load()
} disabled = { loading || saving} style = { styles.back } >
    <Ionicons name="refresh" size = { 19} color = { TEAL } />
        <Text style={ styles.backText }> Refresh </Text>
            </View>
            </View>
            < Text style = { styles.eyebrow } > RRALLC HOME SERVICES </Text>
                < Text style = { styles.title } > Job Payments </Text>
                    < Text style = { styles.subtitle } > Record a payment and review the remaining job balance.</Text>

{ loading ? <ActivityIndicator size="large" color = { TEAL } style = { styles.spinner } /> : null }
{
    error ? (
        <View style= { styles.notice } >
        <Text style={ styles.error }> { error } </Text>
            < Pressable onPress = {() => router.push('/owner-login')
} style = { styles.secondaryButton } >
    <Text style={ styles.secondaryText }> Owner Login </Text>
        </Pressable>
        </View>
        ) : null}

{
    authorized && !loading ? (
        <>
        <View style= { styles.card } >
        <View style={ styles.sectionRow }>
            <Text style={ styles.cardTitle }> Select a job </Text>
                < Pressable onPress = {() => setShowJobs(!showJobs)
}>
    <Text style={ styles.link }> { showJobs? 'Hide jobs': 'Change job' } </Text>
        </Pressable>
        </View>
{
    job ? (
        <View style= { styles.selectedJob } >
        <Text style={ styles.customer }> { job.customer_name || 'Unnamed customer' } </Text>
            < Text style = { styles.muted } > { job.service || 'Service' } • { job.city || 'No city' } </Text>
                </View>
              ) : <Text style={ styles.muted }> Choose a customer job below.</Text>
}
{
    showJobs ? (
        <View style= { styles.jobList } >
        { jobs.length === 0 ? <Text style={ styles.muted }> No jobs found.</Text> : null
}
{
    jobs.map((item) => (
        <Pressable key= { item.id } style = { [styles.jobRow, jobId === item.id ? styles.jobRowActive : null]} onPress = {() => selectJob(item.id)}>
            <View style={ { flex: 1 } }>
                <Text style={ styles.jobName }> { item.customer_name || 'Unnamed customer' } </Text>
                    < Text style = { styles.muted } > { item.service || 'Service' } • { item.status || 'New' } </Text>
                        </View>
                        < Text style = { styles.jobPrice } > { money(asNumber(item.final_price ?? item.estimated_price))}</Text>
                            </Pressable>
                  ))}
</View>
              ) : null}
</View>

{
    job ? (
        <>
        <View style= { styles.summary } >
        <View style={ styles.metric }>
            <Text style={ styles.metricLabel }> Job total </Text>
                < Text style = { styles.metricValue } > { money(total) } </Text>
                    </View>
                    < View style = { styles.metric } >
                        <Text style={ styles.metricLabel }> Recorded paid </Text>
                            < Text style = { styles.metricValue } > { money(paid) } </Text>
                                </View>
                                < View style = { styles.metric } >
                                    <Text style={ styles.metricLabel }> Remaining </Text>
                                        < Text style = { [styles.metricValue, { color: balance > 0 ? TEAL : NAVY }]} > { money(balance) } </Text>
                                            </View>
                                            </View>

                                            < View style = { styles.card } >
                                                <Text style={ styles.cardTitle }> Record payment </Text>
    {
        balance <= 0 ? (
            <Text style= { styles.success } > This job has no outstanding balance.</Text>
                  ) : (
            <>
            <Text style= { styles.label } > Amount($) </Text>
            < TextInput style = { styles.input } keyboardType = "decimal-pad" placeholder = "0.00" value = { amount } onChangeText = { setAmount } />
                <Pressable onPress={ () => setAmount(balance.toFixed(2)) } style = { styles.fillButton } >
                    <Text style={ styles.link }> Use full remaining balance({ money(balance) }) </Text>
                        </Pressable>
                        < Text style = { styles.label } > Payment method </Text>
                            < View style = { styles.methods } >
                            {
                                METHODS.map((item) => (
                                    <Pressable key= { item } onPress = {() => setMethod(item)} style = { [styles.method, method === item ? styles.methodActive : null]} >
                                        <Text style={ [styles.methodText, method === item ? styles.methodTextActive : null] }> { item } </Text>
                                            </Pressable>
                        ))
    }
    </View>
        < Pressable disabled = { saving } onPress = {() => void recordPayment()
} style = { [styles.primaryButton, saving ? { opacity: 0.5 } : null]} >
    { saving?<ActivityIndicator color = "#FFFFFF" /> : <Ionicons name="checkmark-circle-outline" size = { 20} color = "#FFFFFF" />}
<Text style={ styles.primaryText }> { saving? 'Saving...': 'Record Payment' } </Text>
    </Pressable>
    </>
                  )}
</View>

    < View style = { styles.card } >
        <View style={ styles.sectionRow }>
            <Text style={ styles.cardTitle }> This job's transactions</Text>
                < Pressable onPress = {() => router.push('/payment-history')}>
                    <Text style={ styles.link }> All history </Text>
                        </Pressable>
                        </View>
{ payments.length === 0 ? <Text style={ styles.muted }> No transaction records for this job yet.</Text> : null}
{
    payments.map((payment, index) => (
        <View key= {`${payment.paid_at ?? 'payment'}-${index}`} style = { styles.transaction } >
            <View style={ { flex: 1 } }>
                <Text style={ styles.jobName }> { payment.method || 'Payment' } </Text>
                    < Text style = { styles.muted } > { payment.paid_at ? new Date(payment.paid_at).toLocaleString() : 'Date not recorded' } </Text>
                        </View>
                        < Text style = { styles.paymentAmount } > { money(asNumber(payment.amount))}</Text>
                            </View>
                  ))}
{
    asNumber(job.amount_paid) > transactionTotal + 0.001 ? (
        <Text style= { styles.note } > Older payments may be included in the job's saved paid amount. Those amounts are not listed as new transactions.</Text>
                  ) : null
}
</View>
    </>
            ) : null}
</>
        ) : null}
</ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#F5F8F9' },
    content: { padding: 20, paddingBottom: 70, width: '100%', maxWidth: 900, alignSelf: 'center' },
    topRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 22 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7 },
    backText: { color: NAVY, fontWeight: '700' },
    eyebrow: { color: TEAL, fontWeight: '900', fontSize: 11, letterSpacing: 1.6 },
    title: { fontSize: 32, fontWeight: '900', color: NAVY, marginTop: 6 },
    subtitle: { color: MUTED, marginTop: 8, marginBottom: 22, fontSize: 15, lineHeight: 22 },
    spinner: { marginTop: 50 },
    notice: { padding: 18, backgroundColor: '#FFF2F2', borderRadius: 12 },
    error: { color: '#A12424', lineHeight: 21 },
    secondaryButton: { marginTop: 15, padding: 12, backgroundColor: '#FFFFFF', borderRadius: 9, alignItems: 'center' },
    secondaryText: { color: NAVY, fontWeight: '800' },
    card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, marginBottom: 17, borderWidth: 1, borderColor: '#E1E9EA' },
    sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 },
    cardTitle: { fontSize: 19, fontWeight: '900', color: NAVY, marginBottom: 12 },
    link: { color: TEAL, fontWeight: '800', fontSize: 13 },
    selectedJob: { padding: 13, backgroundColor: '#F1F7F7', borderRadius: 10 },
    customer: { color: NAVY, fontSize: 17, fontWeight: '800', marginBottom: 5 },
    muted: { color: MUTED, fontSize: 13, lineHeight: 20 },
    jobList: { marginTop: 10 },
    jobRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: '#E7EEEE' },
    jobRowActive: { backgroundColor: '#EDF7F5' },
    jobName: { color: NAVY, fontSize: 14, fontWeight: '800' },
    jobPrice: { color: NAVY, fontWeight: '900' },
    summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 17 },
    metric: { flexGrow: 1, flexBasis: 160, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 18, borderWidth: 1, borderColor: '#E1E9EA' },
    metricLabel: { color: MUTED, fontSize: 12, marginBottom: 9 },
    metricValue: { color: NAVY, fontSize: 23, fontWeight: '900' },
    label: { color: NAVY, fontSize: 12, fontWeight: '900', marginTop: 10, marginBottom: 8 },
    input: { borderWidth: 1, borderColor: '#CFDDDF', borderRadius: 10, padding: 13, fontSize: 18, color: NAVY },
    fillButton: { alignSelf: 'flex-start', paddingVertical: 12 },
    methods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
    method: { borderWidth: 1, borderColor: '#CCDADC', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 9 },
    methodActive: { backgroundColor: TEAL, borderColor: TEAL },
    methodText: { color: NAVY, fontWeight: '700', fontSize: 13 },
    methodTextActive: { color: '#FFFFFF' },
    primaryButton: { backgroundColor: TEAL, padding: 16, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
    primaryText: { color: '#FFFFFF', fontWeight: '900', fontSize: 15 },
    success: { color: TEAL, fontWeight: '800', lineHeight: 23 },
    transaction: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderColor: '#E7EEEE', gap: 10 },
    paymentAmount: { color: TEAL, fontWeight: '900', fontSize: 16 },
    note: { color: MUTED, fontSize: 12, lineHeight: 19, marginTop: 14 },
});