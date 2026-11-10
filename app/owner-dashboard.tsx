
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';

type Quote = {
  id: string;
  created_at: string;
  customer_name: string;
  contact: string;
  city: string;
  service: string;
  quantity: number;
  haul_away: boolean;
  estimated_price: number | null;
  details: string | null;
  status: string;
  scheduled_at: string | null;
  estimated_duration_minutes: number | null;
  scheduling_notes: string | null;
};

const statuses = [
  'new', 'contacted', 'scheduled', 'completed',
] as const;

const TIME_ZONE = 'America/Los_Angeles';

function dateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (name: string) =>
    parts.find(p => p.type === name)?.value || '';

  return `${get('year')}-${get('month')}-${get('day')}`;
}

function displayTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function toLocalFields(value: string | null) {
  if (!value) {
    return { date: '', time: '09:00' };
  }

  const d = new Date(value);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);

  return { date: dateParts(d), time };
}

// Convert a California wall-clock time to UTC, including DST.
function californiaToISO(day: string, time: string) {
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const clock = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!match || !clock) {
    throw new Error('Use YYYY-MM-DD and HH:MM (24-hour time).');
  }

  const [year, month, date] = match.slice(1).map(Number);
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);

  const check = new Date(Date.UTC(year, month - 1, date));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== date
  ) {
    throw new Error('Enter a valid calendar date.');
  }

  const target = Date.UTC(year, month - 1, date, hour, minute);
  const matches: Date[] = [];

  // Check both California standard and daylight offsets.
  for (const offsetHours of [7, 8]) {
    const candidate = new Date(
      target + offsetHours * 60 * 60 * 1000
    );

    const fields = toLocalFields(candidate.toISOString());
    if (fields.date === day && fields.time === time) {
      matches.push(candidate);
    }
  }

  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? 'That time does not exist due to daylight saving time.'
        : 'That time is ambiguous due to daylight saving time. Choose another time.'
    );
  }

  return matches[0].toISOString();
}

export default function OwnerDashboard() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [duration, setDuration] = useState('120');
  const [notes, setNotes] = useState('');

  const [month, setMonth] = useState(() => {
    const [y, m] = dateParts(new Date()).split('-').map(Number);
    return new Date(y, m - 1, 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const loadQuotes = useCallback(async () => {
    try {
      setError('');

      const { data: auth, error: authError } =
        await supabase.auth.getUser();

      if (authError || !auth.user) {
        setAuthorized(false);
        router.replace('/owner-login');
        return;
      }

      const { data: owner, error: ownerError } =
        await supabase
          .from('rrallc_owners')
          .select('user_id')
          .eq('user_id', auth.user.id)
          .maybeSingle();

      if (ownerError) throw ownerError;

      if (!owner) {
        setAuthorized(false);
        await supabase.auth.signOut();
        router.replace('/owner-login');
        return;
      }

      setAuthorized(true);

      const { data, error: queryError } = await supabase
        .from('quote_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (queryError) throw queryError;
      setQuotes((data || []) as Quote[]);
    } catch (e: any) {
      setError(e.message || 'Unable to load jobs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuotes();
  }, [loadQuotes]);

  async function updateStatus(id: string, status: string) {
    setBusyId(id);
    try {
      const { data, error } = await supabase
        .from('quote_requests')
        .update({ status })
        .eq('id', id)
        .select('id, status')
        .single();

      if (error) throw error;

      setQuotes(prev => prev.map(q =>
        q.id === id ? { ...q, status: data.status } : q
      ));
    } catch (e: any) {
      Alert.alert('Update failed', e.message);
    } finally {
      setBusyId(null);
    }
  }

  function editSchedule(q: Quote) {
    const fields = toLocalFields(q.scheduled_at);
    setEditingId(q.id);
    setDate(fields.date || dateParts(new Date()));
    setTime(fields.time);
    setDuration(String(q.estimated_duration_minutes || 120));
    setNotes(q.scheduling_notes || '');
  }

  async function saveSchedule(q: Quote) {
    setBusyId(q.id);

    try {
      const scheduledAt = californiaToISO(date.trim(), time.trim());
      const minutes = Number(duration);

      if (!Number.isInteger(minutes) || minutes < 30 || minutes > 720) {
        throw new Error('Duration must be 30–720 minutes.');
      }

      const start = new Date(scheduledAt).getTime();
      const end = start + minutes * 60000;

      // Client-side overlap warning for existing appointments.
      const conflict = quotes.find(other => {
        if (
          other.id === q.id ||
          !other.scheduled_at ||
          other.status === 'completed'
        ) return false;

        const otherStart = new Date(other.scheduled_at).getTime();
        const otherEnd =
          otherStart +
          (other.estimated_duration_minutes || 120) * 60000;

        return start < otherEnd && end > otherStart;
      });

      if (conflict) {
        throw new Error(
          `Time overlaps with ${conflict.customer_name}'s appointment.`
        );
      }

      const { data, error } = await supabase
        .from('quote_requests')
        .update({
          scheduled_at: scheduledAt,
          estimated_duration_minutes: minutes,
          scheduling_notes: notes.trim(),
          status: 'scheduled',
        })
        .eq('id', q.id)
        .select('*')
        .single();

      if (error) throw error;

      setQuotes(prev => prev.map(item =>
        item.id === q.id ? data as Quote : item
      ));
      setEditingId(null);
      Alert.alert('Saved', 'Appointment scheduled successfully.');
    } catch (e: any) {
      Alert.alert('Scheduling failed', e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeSchedule(q: Quote) {
    setBusyId(q.id);

    try {
      const { data, error } = await supabase
        .from('quote_requests')
        .update({
          scheduled_at: null,
          estimated_duration_minutes: null,
          scheduling_notes: null,
          status: 'contacted',
        })
        .eq('id', q.id)
        .select('*')
        .single();

      if (error) throw error;

      setQuotes(prev => prev.map(item =>
        item.id === q.id ? data as Quote : item
      ));
      setEditingId(null);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert('Sign out failed', error.message);
      return;
    }
    router.replace('/owner-login');
  }

  const scheduled = quotes
    .filter(q => q.scheduled_at && q.status !== 'completed')
    .sort((a, b) =>
      new Date(a.scheduled_at!).getTime() -
      new Date(b.scheduled_at!).getTime()
    );

  const upcoming = scheduled.filter(
    q => new Date(q.scheduled_at!).getTime() >= Date.now()
  );

  const monthYear = month.getFullYear();
  const monthIndex = month.getMonth();
  const daysInMonth = new Date(
    monthYear, monthIndex + 1, 0
  ).getDate();
  const firstWeekday = new Date(
    monthYear, monthIndex, 1
  ).getDay();

  const calendarCells: (string | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      `${monthYear}-${String(monthIndex + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
    ),
  ];

  const displayedJobs = selectedDay
    ? scheduled.filter(q =>
        dateParts(new Date(q.scheduled_at!)) === selectedDay
      )
    : upcoming;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#38bdf8" />
        <Text style={styles.muted}>Loading dashboard...</Text>
      </View>
    );
  }

  if (!authorized) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || 'Owner access required.'}</Text>
        <Pressable style={styles.button} onPress={loadQuotes}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>RRALLC HOME SERVICES</Text>
            <Text style={styles.title}>Owner Dashboard</Text>
          </View>
          <Pressable onPress={signOut} style={styles.outline}>
            <Text style={styles.link}>Sign Out</Text>
          </Pressable>
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{quotes.length}</Text>
            <Text style={styles.muted}>Quotes</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>
              {quotes.filter(q => q.status === 'new').length}
            </Text>
            <Text style={styles.muted}>New</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{upcoming.length}</Text>
            <Text style={styles.muted}>Upcoming</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.muted}>Total Estimated Quote Value</Text>
          <Text style={styles.money}>
            ${quotes.reduce(
              (sum, q) => sum + Number(q.estimated_price || 0), 0
            ).toFixed(2)}
          </Text>
          <Text style={styles.muted}>
            Estimates only — not confirmed revenue
          </Text>
        </View>

<Pressable
  style={styles.button}
  onPress={() => router.push('/revenue-dashboard')}
>
  <Text style={styles.buttonText}>
    View Revenue Dashboard
  </Text>
</Pressable>
   
        <Text style={styles.heading}>Job Calendar</Text>

        <View style={styles.card}>
          <View style={styles.calendarHeader}>
            <Pressable onPress={() => setMonth(
              new Date(monthYear, monthIndex - 1, 1)
            )}>
              <Text style={styles.link}>‹ Previous</Text>
            </Pressable>

            <Text style={styles.calendarTitle}>
              {month.toLocaleString('en-US', {
                month: 'long',
                year: 'numeric',
              })}
            </Text>

            <Pressable onPress={() => setMonth(
              new Date(monthYear, monthIndex + 1, 1)
            )}>
              <Text style={styles.link}>Next ›</Text>
            </Pressable>
          </View>

          <View style={styles.calendarGrid}>
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
              <View key={d} style={styles.dayCell}>
                <Text style={styles.weekday}>{d}</Text>
              </View>
            ))}

            {calendarCells.map((day, i) => {
              const count = day
                ? scheduled.filter(q =>
                    dateParts(new Date(q.scheduled_at!)) === day
                  ).length
                : 0;

              return (
                <Pressable
                  key={day || `blank-${i}`}
                  disabled={!day}
                  onPress={() => setSelectedDay(
                    selectedDay === day ? null : day
                  )}
                  style={[
                    styles.dayCell,
                    styles.calendarDay,
                    day === selectedDay && styles.selectedDay,
                  ]}
                >
                  <Text style={styles.dayNumber}>
                    {day ? Number(day.slice(-2)) : ''}
                  </Text>
                  {count > 0 && (
                    <Text style={styles.dot}>{count} job</Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          <Pressable onPress={() => setSelectedDay(null)}>
            <Text style={styles.link}>Show all upcoming jobs</Text>
          </Pressable>
        </View>

        <Text style={styles.heading}>
          {selectedDay ? `Jobs for ${selectedDay}` : 'Upcoming Jobs'}
        </Text>

        {displayedJobs.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.muted}>
              No appointments for this selection.
            </Text>
          </View>
        ) : displayedJobs.map(q => (
          <View key={q.id} style={styles.card}>
            <Text style={styles.customer}>{q.customer_name}</Text>
            <Text style={styles.appointment}>
              {displayTime(q.scheduled_at!)}
            </Text>
            <Text style={styles.field}>{q.service} — {q.city}</Text>
            <Text style={styles.field}>
              Duration: {q.estimated_duration_minutes || 120} minutes
            </Text>
            <Text style={styles.field}>Contact: {q.contact}</Text>
            <Pressable onPress={() => editSchedule(q)}>
              <Text style={styles.link}>Edit appointment</Text>
            </Pressable>

  

          </View>
        ))}

        <View style={styles.sectionHeader}>
          <Text style={styles.heading}>Customer Requests</Text>
          <Pressable onPress={loadQuotes}>
            <Text style={styles.link}>Refresh</Text>
          </Pressable>
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}

        {quotes.map(q => (
          <View key={q.id} style={styles.card}>
            <View style={styles.sectionHeader}>
              <Text style={styles.customer}>{q.customer_name}</Text>
              <Text style={styles.price}>
                ${Number(q.estimated_price || 0).toFixed(2)}
              </Text>
    <Pressable
style = { styles.button }
onPress = {() =>
router.push({
    pathname: '/payment-history',
    params: { id: q.id },
})
  }
>
    <Text style={ styles.buttonText }>
        Payment History
            </Text>
            </Pressable>

            <Pressable 
style = { styles.button }
onPress = {() =>
router.push({
    pathname: '/job-invoice',
    params: { id: q.id },
})
  }
>
    <Text style={ styles.buttonText }>
        Invoice & Receipt
        </Text>
        </Pressable>
            </View>

            <Text style={styles.field}>Contact: {q.contact}</Text>
            <Text style={styles.field}>City: {q.city}</Text>
            <Text style={styles.field}>Service: {q.service}</Text>
            <Text style={styles.field}>Quantity: {q.quantity}</Text>
            <Text style={styles.field}>
              Haul away: {q.haul_away ? 'Yes' : 'No'}
            </Text>
            {!!q.details && (
              <Text style={styles.field}>Details: {q.details}</Text>
            )}

            <Text style={styles.muted}>
              Received: {displayTime(q.created_at)}
            </Text>

            {!!q.scheduled_at && (
              <Text style={styles.appointment}>
                Appointment: {displayTime(q.scheduled_at)}
              </Text>
            )}

            <Text style={styles.subheading}>
              Status: {q.status.toUpperCase()}
            </Text>

            <View style={styles.statusRow}>
              {statuses.map(status => (
                <Pressable
                  key={status}
                  disabled={busyId === q.id}
                  onPress={() => updateStatus(q.id, status)}
                  style={[
                    styles.statusButton,
                    q.status === status && styles.active,
                  ]}
                >
                  <Text style={styles.statusText}>{status}</Text>
                </Pressable>
              ))}
            </View>

            {editingId === q.id ? (
              <View style={styles.editor}>
                <Text style={styles.subheading}>Schedule Appointment</Text>
                <Text style={styles.muted}>
                  California local time (Pacific)
                </Text>

                <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.input}
                  value={date}
                  onChangeText={setDate}
                  placeholder="2026-11-10"
                  placeholderTextColor="#64748b"
                />

                <Text style={styles.label}>Time (24-hour HH:MM)</Text>
                <TextInput
                  style={styles.input}
                  value={time}
                  onChangeText={setTime}
                  placeholder="09:00"
                  placeholderTextColor="#64748b"
                />

                <Text style={styles.label}>Duration (minutes)</Text>
                <TextInput
                  style={styles.input}
                  value={duration}
                  onChangeText={setDuration}
                  keyboardType="number-pad"
                />

                <Text style={styles.label}>Job Notes</Text>
                <TextInput
                  style={[styles.input, { minHeight: 75 }]}
                  multiline
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Tools, arrival instructions..."
                  placeholderTextColor="#64748b"
                />

                <Pressable
                    style={styles.button}
                    disabled={busyId === q.id}
                    onPress={() => saveSchedule(q)}
                >
                  <Text style={styles.buttonText}>{busyId === q.id ? 'Saving...' : 'Save Appointment'}</Text>
                </Pressable>

{
    !!q.scheduled_at && (
        <Pressable
    style={ styles.outline }
    disabled = { busyId === q.id
}
onPress = {() => removeSchedule(q)}
  >
    <Text style={ styles.link }>
        Remove Appointment
            </Text>
            </Pressable>
)}

                <Pressable onPress={() => setEditingId(null)}>
                  <Text style={styles.link}>Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={styles.button}
                onPress={() => editSchedule(q)}
              >
                <Text style={styles.buttonText}>
                  {q.scheduled_at
                    ? 'Edit Schedule'
                    : 'Schedule Job'}
                </Text>
              </Pressable>
   
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b1220' },
  center: {
    flex: 1, backgroundColor: '#0b1220',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  content: { padding: 18, paddingBottom: 70 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 22, gap: 10,
  },
  brand: {
    color: '#38bdf8', fontSize: 12,
    fontWeight: '800', letterSpacing: 1,
  },
  title: { color: 'white', fontSize: 25, fontWeight: '900' },
  heading: {
    color: 'white', fontSize: 21,
    fontWeight: '800', marginVertical: 14,
  },
  subheading: {
    color: 'white', fontSize: 15,
    fontWeight: '800', marginTop: 16, marginBottom: 10,
  },
  muted: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  card: {
    backgroundColor: '#172033', padding: 17,
    borderRadius: 13, marginBottom: 14,
    borderWidth: 1, borderColor: '#334155',
  },
  stats: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  stat: {
    flex: 1, backgroundColor: '#172033',
    padding: 12, borderRadius: 12, alignItems: 'center',
  },
  statNumber: { color: 'white', fontSize: 25, fontWeight: '900' },
  money: {
    color: '#38bdf8', fontSize: 30,
    fontWeight: '900', marginVertical: 8,
  },
  customer: { color: 'white', fontSize: 18, fontWeight: '800' },
  price: { color: '#38bdf8', fontSize: 17, fontWeight: '800' },
  field: { color: '#e2e8f0', fontSize: 14, marginTop: 8 },
  appointment: {
    color: '#38bdf8', fontWeight: '800', marginTop: 10,
  },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', gap: 10,
  },
  link: { color: '#38bdf8', fontWeight: '700', paddingVertical: 8 },
  outline: {
    borderWidth: 1, borderColor: '#475569',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4,
    alignItems: 'center', marginTop: 8,
  },
  button: {
    backgroundColor: '#0284c7', padding: 14,
    borderRadius: 10, alignItems: 'center', marginTop: 15,
  },
  buttonText: { color: 'white', fontWeight: '800' },
  error: { color: '#f87171', marginVertical: 12 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statusButton: {
    borderWidth: 1, borderColor: '#475569',
    padding: 9, borderRadius: 7,
  },
  active: { backgroundColor: '#0284c7', borderColor: '#0284c7' },
  statusText: {
    color: 'white', fontSize: 12,
    fontWeight: '700', textTransform: 'capitalize',
  },
  editor: {
    marginTop: 15, borderTopWidth: 1,
    borderColor: '#475569', paddingTop: 12,
  },
  label: { color: '#e2e8f0', marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: '#0b1220', borderColor: '#475569',
    borderWidth: 1, borderRadius: 8,
    padding: 13, color: 'white', fontSize: 16,
  },
  calendarHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 14,
  },
  calendarTitle: { color: 'white', fontWeight: '800' },
  calendarGrid: {
    flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12,
  },
  dayCell: {
    width: '14.2857%', alignItems: 'center',
    justifyContent: 'center', minHeight: 39,
  },
  calendarDay: { borderRadius: 6, marginVertical: 2 },
  selectedDay: { backgroundColor: '#075985' },
  weekday: { color: '#94a3b8', fontSize: 10 },
  dayNumber: { color: 'white', fontSize: 13 },
  dot: { color: '#38bdf8', fontSize: 9, fontWeight: '700' },
});
