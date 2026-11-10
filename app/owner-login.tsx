
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';

export default function OwnerLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function signIn() {
    if (!email.trim() || !password) {
      setErrorMessage('Enter your email and password.');
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      const { data, error } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (error) throw error;

      if (!data.user) {
        throw new Error('Sign-in failed.');
      }

      // Check owner permission in the database.
      const { data: owner, error: ownerError } =
        await supabase
          .from('rrallc_owners')
          .select('user_id')
          .eq('user_id', data.user.id)
          .maybeSingle();

      if (ownerError) throw ownerError;

      if (!owner) {
        await supabase.auth.signOut();
        throw new Error(
          'This account does not have RRALLC owner access.'
        );
      }

      router.replace('/owner-dashboard' as any);
    } catch (error: any) {
      setErrorMessage(
        error?.message || 'Unable to sign in.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.logo}>RRALLC</Text>
        <Text style={styles.subtitle}>HOME SERVICES</Text>

        <View style={styles.card}>
          <Text style={styles.title}>Owner Login</Text>
          <Text style={styles.description}>
            Sign in to manage customer quote requests.
          </Text>

          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={styles.input}
            placeholder="Owner email"
            placeholderTextColor="#888"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#888"
            secureTextEntry
            autoComplete="current-password"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={signIn}
          />

          {errorMessage ? (
            <Text style={styles.error}>{errorMessage}</Text>
          ) : null}

          <Pressable
            style={[
              styles.button,
              loading && styles.disabled,
            ]}
            onPress={signIn}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                Sign In
              </Text>
            )}
          </Pressable>

          <Pressable
            style={styles.backButton}
            onPress={() => router.replace('/')}
          >
            <Text style={styles.backText}>
              Back to Home Services
            </Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>
          Authorized RRALLC personnel only
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1220',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logo: {
    fontSize: 36,
    fontWeight: '900',
    color: '#fff',
    textAlign: 'center',
  },
  subtitle: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 35,
  },
  card: {
    backgroundColor: '#172033',
    padding: 24,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#334155',
  },
  title: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8,
  },
  description: {
    color: '#94a3b8',
    fontSize: 14,
    marginBottom: 25,
  },
  label: {
    color: '#e2e8f0',
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 10,
    padding: 15,
    color: '#fff',
    fontSize: 16,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#0284c7',
    padding: 17,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 5,
  },
  disabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  error: {
    color: '#f87171',
    marginBottom: 15,
  },
  backButton: {
    padding: 20,
    alignItems: 'center',
  },
  backText: {
    color: '#38bdf8',
    fontWeight: '600',
  },
  footer: {
    color: '#64748b',
    textAlign: 'center',
    marginTop: 30,
    fontSize: 12,
  },
});
