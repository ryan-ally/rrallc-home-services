import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';

type Job = {
  id: string;
  customer_name: string;
  contact: string | null;
  city: string | null;
  service: string;
  details: string | null;
  final_price: number | null;
  amount_paid: number | null;
};

type Payment = {
  id: string;
  amount: number;
  method: string;
  paid_at: string;
  notes: string | null;
};

type Invoice = {
  id: string;
  invoice_number: number;
  issued_at: string;
  due_at: string | null;
  description: string | null;
};

const dollars = (value: number) =>
  '$' + (Number.isFinite(value) ? value : 0).toFixed(2);

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatDate = (value: string | null | undefined) => {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-US');
};

export default function JobInvoiceScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [job, setJob] = useState<Job | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) {
        router.replace('/owner-login');
        return;
      }

      const { data: owner, error: ownerError } = await supabase
        .from('rrallc_owners')
        .select('user_id')
        .eq('user_id', auth.user.id)
        .maybeSingle();
      if (ownerError) throw ownerError;
      if (!owner) {
        router.replace('/owner-login');
        return;
      }
      if (!id) {
        throw new Error('No job ID was supplied. Open this page from a job in Owner Dashboard.');
      }

      const [jobResult, paymentsResult, invoiceResult] = await Promise.all([
        supabase
          .from('quote_requests')
          .select('id,customer_name,contact,city,service,details,final_price,amount_paid')
          .eq('id', id)
          .single(),
        supabase
          .from('payment_transactions')
          .select('id,amount,method,paid_at,notes')
          .eq('quote_request_id', id)
          .order('paid_at', { ascending: false }),
        supabase
          .from('job_invoices')
          .select('id,invoice_number,issued_at,due_at,description')
          .eq('quote_request_id', id)
          .maybeSingle(),
      ]);

      if (jobResult.error) throw jobResult.error;
      if (paymentsResult.error) throw paymentsResult.error;
      if (invoiceResult.error) throw invoiceResult.error;

      setJob(jobResult.data as Job);
      setPayments((paymentsResult.data ?? []) as Payment[]);
      setInvoice((invoiceResult.data ?? null) as Invoice | null);
    } catch (e: any) {
      setError(e?.message || 'Could not load invoice information.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = job?.final_price == null ? null : Number(job.final_price);
  const received = payments.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0
  );
  const balance = total == null ? null : Math.max(0, total - received);

  async function createInvoice() {
    if (!job || busy) return;
    setError('');
    setNotice('');
    if (
      job.final_price == null ||
      !Number.isFinite(Number(job.final_price)) ||
      Number(job.final_price) < 0
    ) {
      setError('Set the final job price before creating an invoice. Open this job in Owner Dashboard to update its final price.');
      return;
    }

    setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc('create_job_invoice', {
        p_quote_id: job.id,
        p_due_at: null,
        p_description: job.service,
      });
      if (rpcError) throw rpcError;

      await load();
      const { data: saved, error: readError } = await supabase
        .from('job_invoices')
        .select('id,invoice_number,issued_at,due_at,description')
        .eq('quote_request_id', job.id)
        .maybeSingle();
      if (readError) throw readError;
      if (!saved) {
        throw new Error('The invoice function completed, but no invoice record was found. Check the create_job_invoice database function.');
      }
      setInvoice(saved as Invoice);
      setNotice(`Invoice #${saved.invoice_number} is ready.`);
    } catch (e: any) {
      setError('Invoice was not confirmed: ' + (e?.message || 'Unknown error'));
    } finally {
      setBusy(false);
    }
  }

  function buildHtml(receipt: boolean): string {
    if (!job || !invoice || total == null) {
      throw new Error('An invoice and final price are required.');
    }
    const rows = payments
      .map(
        (p) => `<tr><td>${escapeHtml(formatDate(p.paid_at))}</td><td>${escapeHtml(p.method)}</td><td class="right">${escapeHtml(dollars(Number(p.amount)))}</td></tr>`
      )
      .join('');
    const details = job.details
      ? `<p class="muted">${escapeHtml(job.details)}</p>`
      : '';

    return `<!doctype html><html><head><meta charset="utf-8"/><style>
      @page{size:letter;margin:18mm}body{font-family:Arial,sans-serif;color:#152439;font-size:13px}
      .top{border-bottom:4px solid #087e91;padding-bottom:15px;display:flex;justify-content:space-between}
      h1{font-size:26px;margin:0;color:#0b3448}h2{font-size:21px;margin:22px 0 8px}
      .muted{color:#586779}.block{margin-top:22px}.right{text-align:right}
      table{width:100%;border-collapse:collapse;margin-top:12px}th{background:#eaf4f7}
      th,td{padding:11px;border-bottom:1px solid #dbe3e8;text-align:left}
      .summary{margin-top:22px;margin-left:auto;width:280px}.summary p{display:flex;justify-content:space-between}
      .due{font-size:19px;font-weight:bold;border-top:2px solid #152439;padding-top:12px}
      footer{margin-top:45px;color:#586779;font-size:11px}
    </style></head><body>
      <div class="top"><div><h1>RRALLC Home Services</h1><p class="muted">California City &amp; Mojave, California</p></div><div class="right"><h2>${receipt ? 'PAYMENT RECEIPT' : 'INVOICE'}</h2><strong>#${escapeHtml(invoice.invoice_number)}</strong></div></div>
      <div class="block"><strong>Bill to</strong><p>${escapeHtml(job.customer_name)}<br/>${escapeHtml(job.contact)}<br/>${escapeHtml(job.city)}</p></div>
      <p><strong>Issued:</strong> ${escapeHtml(formatDate(invoice.issued_at))}${invoice.due_at ? `<br/><strong>Due:</strong> ${escapeHtml(formatDate(invoice.due_at))}` : ''}</p>
      <h2>Services</h2><table><thead><tr><th>Description</th><th class="right">Amount</th></tr></thead><tbody><tr><td>${escapeHtml(invoice.description || job.service)}${details}</td><td class="right">${escapeHtml(dollars(total))}</td></tr></tbody></table>
      <h2>Recorded payments</h2><table><thead><tr><th>Date</th><th>Method</th><th class="right">Amount</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No payments recorded</td></tr>'}</tbody></table>
      <div class="summary"><p><span>Job total</span><strong>${escapeHtml(dollars(total))}</strong></p><p><span>Paid</span><strong>${escapeHtml(dollars(received))}</strong></p><p class="due"><span>Balance due</span><span>${escapeHtml(dollars(Math.max(0, total - received)))}</span></p></div>
      <footer>${receipt ? 'Receipt of payments recorded for this job. This is not a separate charge.' : 'Thank you for choosing RRALLC Home Services.'}</footer>
    </body></html>`;
  }

  async function exportPdf(receipt: boolean) {
    if (busy) return;
    setError('');
    setNotice('');
    if (!invoice) {
      setError('Create the numbered invoice first.');
      return;
    }
    if (receipt && received <= 0) {
      setError('Record a payment before creating a receipt.');
      return;
    }

    setBusy(true);
    try {
      const document = buildHtml(receipt);
      if (Platform.OS === 'web') {
        await Print.printAsync({ html: document });
        setNotice('Use your browser print dialog to save or print the PDF.');
      } else {
        const result = await Print.printToFileAsync({ html: document });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(result.uri, {
            mimeType: 'application/pdf',
            dialogTitle: receipt ? 'Share receipt' : 'Share invoice',
          });
        } else {
          await Print.printAsync({ html: document });
          setNotice('Sharing is unavailable; opened the print dialog instead.');
        }
      }
    } catch (e: any) {
      setError('PDF error: ' + (e?.message || 'Could not create document.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !job) {
    return (
      <View style= { s.center } >
      <ActivityIndicator size="large" color = "#38bdf8" />
        <Text style={ s.muted }> Loading invoice...</Text>
          </View>
    );
  }

  if (!job) {
    return (
      <View style= { s.center } >
      <Text style={ s.error }> { error || 'Job not found.'
  } </Text>
    < Pressable onPress = {() => void load()
} style = { s.button } >
  <Text style={ s.buttonText }> Retry </Text>
    </Pressable>
    </View>
    );
  }

return (
  <SafeAreaView style= { s.safe } >
  <ScrollView contentContainerStyle={ s.content }>
    <Pressable onPress={ () => router.push('/owner-dashboard') }>
      <Text style={ s.link }>‹ Owner Dashboard </Text>
        </Pressable>

        < Text style = { s.title } > Invoice & amp; Receipt </Text>
          < Text style = { s.subtitle } > RRALLC Home Services </Text>

            < View style = { s.card } >
              <Text style={ s.label }> CUSTOMER </Text>
                < Text style = { s.heading } > { job.customer_name } </Text>
                  < Text style = { s.muted } > { job.service } </Text>
{ !!job.city && <Text style={ s.muted }> { job.city } </Text> }
{ !!job.contact && <Text style={ s.muted }> { job.contact } </Text> }
</View>

  < View style = { s.card } >
    <Text style={ s.label }> JOB SUMMARY </Text>
      < View style = { s.line } >
        <Text style={ s.muted }> Final price </Text>
          < Text style = { s.value } > { total == null ? 'Not set' : dollars(total)}</Text>
            </View>
            < View style = { s.line } >
              <Text style={ s.muted }> Payments received </Text>
                < Text style = { s.value } > { dollars(received) } </Text>
                  </View>
                  < View style = { s.separator } />
                    <View style={ s.line }>
                      <Text style={ s.heading }> Balance due </Text>
                        < Text style = { s.amount } > { balance == null ? 'Not set' : dollars(balance)}</Text>
                          </View>
                          </View>

{
  invoice ? (
    <View style= { s.card } >
    <Text style={ s.label }> NUMBERED INVOICE </Text>
      < Text style = { s.heading } > Invoice #{ invoice.invoice_number } </Text>
        < Text style = { s.muted } > Issued { formatDate(invoice.issued_at) } </Text>
          < Pressable
  disabled = { busy }
  style = { [s.button, busy && s.disabled]}
  onPress = {() => void exportPdf(false)
}
            >
  <Text style={ s.buttonText }>
    { busy? 'Please wait...': 'Print / Share Invoice PDF' }
    </Text>
    </Pressable>
    < Pressable
disabled = { busy || received <= 0}
style = { [s.secondaryButton, (busy || received <= 0) && s.disabled]}
onPress = {() => void exportPdf(true)}
            >
  <Text style={ s.buttonText }> Print / Share Payment Receipt </Text>
    </Pressable>
    </View>
        ) : (
  <View style= { s.card } >
  <Text style={ s.heading }> Create a numbered invoice </Text>
    < Text style = { s.muted } >
      This saves an invoice number using your existing Supabase function.
</Text>
{
  total == null && (
    <Text style={ s.warning }>
      A final job price must be set before an invoice can be created.
              </Text>
            )
}
<Pressable
              disabled={ busy || total == null }
style = { [s.button, (busy || total == null) && s.disabled]}
onPress = {() => void createInvoice()}
            >
  <Text style={ s.buttonText }> { busy? 'Creating...': 'Create Invoice' } </Text>
    </Pressable>
    </View>
        )}

<View style={ s.card }>
  <Text style={ s.heading }> Payment history({ payments.length }) </Text>
{
  payments.length === 0 ? (
    <Text style= { s.muted } > No payments recorded yet.</Text>
          ) : (
    payments.map((p) => (
      <View key= { p.id } style = { s.payment } >
      <View style={ s.line } >
    <Text style={ s.value } > { dollars(Number(p.amount))} </Text>
      < Text style = { s.muted } > { p.method } </Text>
        </View>
        < Text style = { s.muted } > { formatDate(p.paid_at) } </Text>
{ !!p.notes && <Text style={ s.muted }> { p.notes } </Text> }
</View>
            ))
          )}
<Pressable
            style={ s.secondaryButton }
onPress = {() =>
router.push({ pathname: '/payment-history', params: { id: job.id } })
            }
          >
  <Text style={ s.buttonText }> View / Record Payments </Text>
    </Pressable>
    </View>

{
  !!notice && (
    <View style={ s.successBox }>
      <Text style={ s.success }> { notice } </Text>
        </View>
        )
}
{
  !!error && (
    <View style={ s.errorBox }>
      <Text style={ s.error }> { error } </Text>
        </View>
        )
}
<Pressable onPress={ () => void load() } disabled = { loading || busy}>
  <Text style={ s.refresh }>
    { loading? 'Refreshing...': 'Refresh invoice data' }
    </Text>
    </Pressable>
    < Text style = { s.footer } >
      Review customer information before sharing invoices or receipts.
        </Text>
        </ScrollView>
        </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b1220' },
  center: {
    flex: 1, backgroundColor: '#0b1220', alignItems: 'center',
    justifyContent: 'center', padding: 20,
  },
  content: {
    padding: 20, paddingBottom: 70, maxWidth: 760,
    width: '100%', alignSelf: 'center',
  },
  title: { fontSize: 29, fontWeight: '900', color: '#fff', marginTop: 20 },
  subtitle: { color: '#8db6c6', marginTop: 5, marginBottom: 10 },
  card: {
    backgroundColor: '#172033', borderRadius: 14, padding: 18,
    marginTop: 16, borderWidth: 1, borderColor: '#27374a',
  },
  heading: { color: '#fff', fontSize: 19, fontWeight: '800' },
  label: {
    color: '#7dd3fc', fontSize: 12, fontWeight: '800',
    letterSpacing: 1, marginBottom: 10,
  },
  muted: { color: '#cbd5e1', marginTop: 6 },
  value: { color: '#fff', fontSize: 16, fontWeight: '700' },
  amount: { color: '#67e8f9', fontSize: 22, fontWeight: '900' },
  line: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', gap: 12, marginVertical: 5,
  },
  separator: { height: 1, backgroundColor: '#334155', marginVertical: 12 },
  payment: { borderTopWidth: 1, borderTopColor: '#334155', paddingVertical: 12 },
  button: {
    backgroundColor: '#0284c7', borderRadius: 10,
    padding: 16, alignItems: 'center', marginTop: 15,
  },
  secondaryButton: {
    backgroundColor: '#31516b', borderRadius: 10,
    padding: 15, alignItems: 'center', marginTop: 12,
  },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.5 },
  link: { color: '#38bdf8', fontWeight: '700' },
  refresh: {
    color: '#7dd3fc', textAlign: 'center',
    fontWeight: '700', padding: 20,
  },
  warning: { color: '#fbbf24', marginTop: 12 },
  error: { color: '#fecaca', fontWeight: '600' },
  success: { color: '#bbf7d0', fontWeight: '700' },
  errorBox: {
    backgroundColor: '#7f1d1d', padding: 14,
    borderRadius: 10, marginTop: 16,
  },
  successBox: {
    backgroundColor: '#14532d', padding: 14,
    borderRadius: 10, marginTop: 16,
  },
  footer: {
    color: '#94a3b8', textAlign: 'center',
    fontSize: 12, marginTop: 10,
  },
});
