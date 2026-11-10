import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView,StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';

const NAVY = '#142B3F';
const TEAL = '#147D7C';
const MUTED = '#617385';
const BG = '#F4F8F8';
const USD = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const number = (value: unknown) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};
const dateLabel = (value: string | null) => {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

type Payment = {
  quote_request_id: string | null;
  amount: number | string | null;
  method: string | null;
  paid_at: string | null;
};
type Quote = {
  id: string;
  customer_name: string | null;
  service: string | null;
  status: string | null;
  final_price: number | string | null;
  estimated_price: number | string | null;
  amount_paid: number | string | null;
  created_at: string | null;
};
type RevenueData = { payments: Payment[]; quotes: Quote[] };
type Period = 'month' | 'year' | 'all';

// Pagination prevents a busy business from silently losing rows at Supabase's default 1,000-row limit.
async function getAllRows<T>(table: string, columns: string): Promise<T[]> {
  const results: T[] = [];
  const batchSize = 500;
  for (let start = 0; ; start += batchSize) {
    const { data, error } = await supabase
      .from(table).select(columns).range(start, start + batchSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    results.push(...batch);
    if (batch.length < batchSize) break;
  }
  return results;
}

export default function RevenueDashboard() {
  const { width } = useWindowDimensions();
  const wide = width >= 800;
  const [data, setData] = useState<RevenueData>({ payments: [], quotes: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>('month');
  const [authorized, setAuthorized] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        setAuthorized(false);
        router.replace('/owner-login');
        return;
      }
      const { data: owner, error: ownerError } = await supabase
        .from('rrallc_owners').select('user_id').eq('user_id', auth.user.id).maybeSingle();
      if (ownerError) throw ownerError;
      if (!owner) {
        setAuthorized(false);
        setError('This account does not have owner access.');
        return;
      }
      setAuthorized(true);
      const [payments, quotes] = await Promise.all([
        getAllRows<Payment>('payment_transactions', 'quote_request_id,amount,method,paid_at'),
        getAllRows<Quote>('quote_requests', 'id,customer_name,service,status,final_price,estimated_price,amount_paid,created_at'),
      ]);
      setData({ payments, quotes });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load revenue information.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const metrics = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const withinPeriod = (dateText: string | null) => {
      if (period === 'all') return true;
      if (!dateText) return false;
      const date = new Date(dateText);
      if (Number.isNaN(date.getTime())) return false;
      return date.getFullYear() === currentYear && (period === 'year' || date.getMonth() === currentMonth);
    };
    const transactions = data.payments.filter(p => withinPeriod(p.paid_at));
    const collected = transactions.reduce((sum, p) => sum + number(p.amount), 0);
    const allTransactionTotal = data.payments.reduce((sum, p) => sum + number(p.amount), 0);
    const transactionsByQuote = new Map<string, number>();
    for (const p of data.payments) {
      if (!p.quote_request_id) continue;
      transactionsByQuote.set(p.quote_request_id, (transactionsByQuote.get(p.quote_request_id) ?? 0) + number(p.amount));
    }
    // Old amount_paid records are not added to dated revenue because their payment dates are unknown.
    // They are shown separately, and never added for jobs that already have transactions.
    const legacy = data.quotes.reduce((sum, q) => sum + (transactionsByQuote.has(q.id) ? 0 : number(q.amount_paid)), 0);
    const outstanding = data.quotes.reduce((sum, q) => {
      if (q.status === 'cancelled') return sum;
      const due = number(q.final_price) > 0 ? number(q.final_price) : number(q.estimated_price);
      const paid = Math.max(transactionsByQuote.get(q.id) ?? 0, number(q.amount_paid));
      return sum + Math.max(0, due - paid);
    }, 0);
    const byMethod = new Map<string, number>();
    for (const p of transactions) {
      const method = (p.method || 'Unspecified').trim() || 'Unspecified';
      byMethod.set(method, (byMethod.get(method) ?? 0) + number(p.amount));
    }
    const months = Array.from({ length: 6 }, (_, i) => {
      const date = new Date(currentYear, currentMonth - (5 - i), 1);
      return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: date.toLocaleDateString('en-US', { month: 'short' }), amount: 0 };
    });
    for (const p of data.payments) {
      if (!p.paid_at) continue;
      const date = new Date(p.paid_at);
      if (Number.isNaN(date.getTime())) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const match = months.find(m => m.key === key);
      if (match) match.amount += number(p.amount);
    }
    const recent = [...data.payments]
      .sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''))
      .slice(0, 12);
    const quoteNames = new Map(data.quotes.map(q => [q.id, q.customer_name || q.service || 'Job payment']));
    return { collected, allTransactionTotal, legacy, outstanding, byMethod: [...byMethod.entries()].sort((a, b) => b[1] - a[1]), months, recent, quoteNames, transactionCount: transactions.length };
  }, [data, period]);

  const metricCard = (label: string, value: string, subtitle: string, icon: keyof typeof Ionicons.glyphMap) => (
    <View style={[styles.metricCard, { width: wide ? '48.7%' : '100%' }]}>
      <View style={styles.metricTop}><Text style={styles.metricLabel}>{label}</Text><Ionicons name={icon} size={21} color={TEAL} /></View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricSub}>{subtitle}</Text>
    </View>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={21} color={NAVY} /><Text style={styles.backText}>Back</Text></Pressable>
        <Pressable onPress={() => void load(true)} style={styles.refresh}><Ionicons name="refresh" size={18} color={TEAL} /><Text style={styles.refreshText}>Refresh</Text></Pressable>
      </View>
      <Text style={styles.eyebrow}>RRALLC HOME SERVICES</Text>
      <Text style={styles.title}>Revenue Dashboard</Text>
      <Text style={styles.description}>Payments received, open balances, and business performance.</Text>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={TEAL} /><Text style={styles.note}>Loading financial data…</Text></View>
      ) : error ? (
        <View style={styles.errorBox}><Text style={styles.errorTitle}>Unable to display revenue</Text><Text style={styles.errorText}>{error}</Text><Pressable style={styles.retry} onPress={() => void load()}><Text style={styles.retryText}>Try again</Text></Pressable></View>
      ) : authorized ? (
        <>
          <View style={styles.periodRow}>
            {([['month', 'This month'], ['year', 'This year'], ['all', 'All time']] as [Period, string][]).map(([key, label]) => (
              <Pressable key={key} onPress={() => setPeriod(key)} style={[styles.periodButton, period === key && styles.periodActive]}>
                <Text style={[styles.periodText, period === key && styles.periodTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.metrics}>
            {metricCard('PAYMENTS COLLECTED', USD(metrics.collected), `${metrics.transactionCount} recorded transactions in selected period`, 'cash-outline')}
            {metricCard('OUTSTANDING JOB BALANCES', USD(metrics.outstanding), 'Across non-cancelled jobs · based on quoted amounts', 'receipt-outline')}
            {metricCard('ALL-TIME TRANSACTIONS', USD(metrics.allTransactionTotal), 'Payments with transaction records', 'card-outline')}
            {metricCard('LEGACY PAYMENTS', USD(metrics.legacy), 'Older job payments without transaction records · undated', 'time-outline')}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Collections by month</Text>
            <Text style={styles.panelSub}>Last six months · transaction payment dates</Text>
            <View style={styles.chart}>
              {metrics.months.map(m => {
                const max = Math.max(1, ...metrics.months.map(x => x.amount));
                return (
                  <View key={m.key} style={styles.barColumn}>
                    <Text style={styles.barAmount}>{m.amount ? `$${Math.round(m.amount)}` : '$0'}</Text>
                    <View style={styles.barTrack}><View style={[styles.barFill, { height: `${Math.max(m.amount ? 6 : 0, (m.amount / max) * 100)}%` }]} /></View>
                    <Text style={styles.barMonth}>{m.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Payment methods</Text>
            <Text style={styles.panelSub}>For selected period</Text>
            {metrics.byMethod.length ? metrics.byMethod.map(([method, amount]) => (
              <View key={method} style={styles.listRow}><Text style={styles.rowLabel}>{method}</Text><Text style={styles.rowAmount}>{USD(amount)}</Text></View>
            )) : <Text style={styles.empty}>No recorded payments in this period.</Text>}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Recent payments</Text>
            <Text style={styles.panelSub}>Latest 12 recorded transactions · all time</Text>
            {metrics.recent.length ? metrics.recent.map((p, i) => (
              <View key={`${p.quote_request_id || 'unknown'}-${p.paid_at || 'undated'}-${i}`} style={styles.paymentRow}>
                <View style={styles.paymentInfo}>
                  <Text style={styles.paymentName} numberOfLines={1}>{p.quote_request_id ? (metrics.quoteNames.get(p.quote_request_id) || 'Job payment') : 'Unlinked payment'}</Text>
                  <Text style={styles.paymentDetail}>{dateLabel(p.paid_at)} · {p.method || 'Unspecified method'}</Text>
                </View>
                <Text style={styles.paymentAmount}>{USD(number(p.amount))}</Text>
              </View>
            )) : <Text style={styles.empty}>No transactions yet. Record a payment to see it here.</Text>}
          </View>
          <Text style={styles.disclaimer}>Revenue is based on payment_transactions.paid_at, not quote creation dates. Legacy amounts are displayed separately because their payment dates are unknown. Outstanding balances are estimates until final job prices are confirmed. This dashboard is a reporting view, not an accounting ledger.</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  content: { width: '100%', maxWidth: 1060, alignSelf: 'center', paddingHorizontal: 20, paddingTop: Platform.OS === 'web' ? 30 : 55, paddingBottom: 70 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7 },
  backText: { color: NAVY, fontSize: 15, fontWeight: '700' },
  refresh: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 10, borderRadius: 9, backgroundColor: '#E2F1EE' },
  refreshText: { color: TEAL, fontWeight: '800' },
  eyebrow: { fontSize: 11, color: TEAL, fontWeight: '900', letterSpacing: 2 },
  title: { fontSize: 32, fontWeight: '900', color: NAVY, marginTop: 9 },
  description: { fontSize: 14, color: MUTED, marginTop: 8, lineHeight: 21 },
  center: { alignItems: 'center', paddingVertical: 80, gap: 14 },
  note: { color: MUTED },
  errorBox: { backgroundColor: '#FFF3F1', padding: 20, borderRadius: 12, marginTop: 24 },
  errorTitle: { fontWeight: '900', color: '#9A3324', fontSize: 17 },
  errorText: { color: '#793E35', marginTop: 9, lineHeight: 21 },
  retry: { backgroundColor: TEAL, alignSelf: 'flex-start', borderRadius: 8, padding: 11, marginTop: 16 },
  retryText: { color: '#FFF', fontWeight: '800' },
  periodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 28, marginBottom: 17 },
  periodButton: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 9, backgroundColor: '#E6EEEE' },
  periodActive: { backgroundColor: TEAL },
  periodText: { fontSize: 13, color: NAVY, fontWeight: '800' },
  periodTextActive: { color: '#FFF' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  metricCard: { backgroundColor: '#FFF', borderRadius: 14, padding: 20, borderWidth: 1, borderColor: '#E2EAEA' },
  metricTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metricLabel: { color: MUTED, fontSize: 11, fontWeight: '900', letterSpacing: 0.6, flex: 1 },
  metricValue: { color: NAVY, fontSize: 28, fontWeight: '900', marginTop: 14 },
  metricSub: { color: MUTED, fontSize: 12, lineHeight: 19, marginTop: 7 },
  panel: { backgroundColor: '#FFF', borderRadius: 14, padding: 20, marginTop: 18, borderWidth: 1, borderColor: '#E2EAEA' },
  panelTitle: { fontSize: 18, fontWeight: '900', color: NAVY },
  panelSub: { color: MUTED, fontSize: 12, marginTop: 5 },
  chart: { flexDirection: 'row', justifyContent: 'space-around', height: 200, marginTop: 25, gap: 6 },
  barColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barAmount: { color: NAVY, fontSize: 10, fontWeight: '700', marginBottom: 8 },
  barTrack: { width: '65%', maxWidth: 65, height: 135, backgroundColor: '#EAF3F2', borderRadius: 6, overflow: 'hidden', justifyContent: 'flex-end' },
  barFill: { width: '100%', backgroundColor: TEAL, borderRadius: 6 },
  barMonth: { color: MUTED, fontSize: 11, marginTop: 8, fontWeight: '700' },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EDF2F2', gap: 12 },
  rowLabel: { color: NAVY, fontSize: 14, flex: 1 },
  rowAmount: { color: TEAL, fontWeight: '900', fontSize: 14 },
  empty: { color: MUTED, marginTop: 18, lineHeight: 21 },
  paymentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#EDF2F2', gap: 12 },
  paymentInfo: { flex: 1 },
  paymentName: { fontSize: 14, color: NAVY, fontWeight: '800' },
  paymentDetail: { fontSize: 12, color: MUTED, marginTop: 5 },
  paymentAmount: { color: TEAL, fontSize: 15, fontWeight: '900' },
  disclaimer: { color: MUTED, fontSize: 11, lineHeight: 18, marginTop: 20 }, recordPaymentButton: {
    backgroundColor: '#147D7C',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 16,
  },
  recordPaymentText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});
