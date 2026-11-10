import React, { useRef, useState } from 'react';
import {
    Alert,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const NAVY = '#142B3F';
const TEAL = '#147D7C';
const MUTED = '#617385';
const LIGHT = '#F2F7F7';

const furniture: [string, number][] = [
    ['Makeup vanity', 120],
    ['Vanity with LED mirror', 160],
    ['Standard bed frame', 100],
    ['Bed frame with storage', 160],
    ['Bunk bed', 200],
    ['Dresser', 120],
    ['Nightstand', 60],
    ['Desk', 100],
    ['Bookshelf', 80],
    ['Entertainment center', 140],
    ['Freestanding cabinet', 120],
    ['TV stand', 100],
];

const homeServices: [string, number][] = [
    ['Replace interior doorknob', 40],
    ['Replace 5 cabinet handles', 50],
    ['Hang pictures or mirrors', 40],
    ['Install curtain rods', 60],
    ['Wall-mount TV', 120],
    ['Install floating shelves', 80],
    ['Assemble patio furniture', 100],
];

const services = [...furniture, ...homeServices];

function notify(title: string, message: string) {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(`${title}\n\n${message}`);
    } else {
        Alert.alert(title, message);
    }
}

export default function Home() {
    const { width } = useWindowDimensions();
    const wide = width > 740;

    const scrollRef = useRef<ScrollView>(null);
    const sections = useRef<Record<string, number>>({});
    const lastSent = useRef(0);

    const [selected, setSelected] = useState(
        'Vanity with LED mirror'
    );
    const [quantity, setQuantity] = useState('1');
    const [haul, setHaul] = useState(false);
    const [customer, setCustomer] = useState('');
    const [contact, setContact] = useState('');
    const [city, setCity] = useState('California City');
    const [details, setDetails] = useState('');
    const [privacyAccepted, setPrivacyAccepted] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const qty = Math.max(
        1,
        Math.min(20, parseInt(quantity, 10) || 1)
    );

    const price =
        services.find(([name]) => name === selected)?.[1] ?? 0;

    const estimated = Math.max(
        100,
        price * qty + (haul ? 20 : 0)
    );

    const scrollTo = (key: string) => {
        scrollRef.current?.scrollTo({
            y: sections.current[key] ?? 0,
            animated: true,
        });
    };

    const sectionPosition = (key: string) => ({
        onLayout: (event: any) => {
            sections.current[key] = event.nativeEvent.layout.y;
        },
    });

    async function send() {
        if (submitting) return;

        const name = customer.trim();
        const reply = contact.trim();
        const info = details.trim();

        const emailValid =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reply);

        const phoneValid =
            /^\+?[\d\s().-]{7,25}$/.test(reply) &&
            reply.replace(/\D/g, '').length >= 7;

        if (name.length < 2 || name.length > 100) {
            notify('Check your name', 'Enter a valid name.');
            return;
        }

        if (
            reply.length > 254 ||
            (!emailValid && !phoneValid)
        ) {
            notify(
                'Check contact',
                'Enter a valid phone number or email.'
            );
            return;
        }

        if (
            !/^\d+$/.test(quantity.trim()) ||
            Number(quantity) < 1 ||
            Number(quantity) > 20
        ) {
            notify('Invalid quantity', 'Enter 1 to 20.');
            return;
        }

        if (info.length > 2000) {
            notify(
                'Details too long',
                'Maximum 2,000 characters.'
            );
            return;
        }

        if (!privacyAccepted) {
            notify(
                'Privacy acknowledgment',
                'Please accept the privacy acknowledgment.'
            );
            return;
        }

        if (Date.now() - lastSent.current < 60000) {
            notify(
                'Please wait',
                'Wait one minute before submitting again.'
            );
            return;
        }

        setSubmitting(true);

        try {
            const { error } = await supabase
                .from('quote_requests')
                .insert({
                    customer_name: name,
                    contact: reply,
                    city,
                    service: selected,
                    quantity: qty,
                    haul_away: haul,
                    estimated_price: estimated,
                    details: info,
                    status: 'new',
                });

            if (error) throw error;

            lastSent.current = Date.now();

            notify(
                'Request submitted',
                'RRALLC Home Services received your request. We will contact you soon.'
            );

            setCustomer('');
            setContact('');
            setDetails('');
            setQuantity('1');
            setHaul(false);
            setPrivacyAccepted(false);
        } catch (error) {
            console.error('Quote submission error:', error);

            notify(
                'Submission failed',
                'Please try again later.'
            );
        } finally {
            setSubmitting(false);
        }
    }

    const heading = (
        label: string,
        title: string,
        description: string
    ) => (
        <View style= { styles.heading } >
        <Text style={ styles.eyebrow }> { label } </Text>
            < Text style = { styles.h2 } > { title } </Text>
                < Text style = { styles.subtitle } > { description } </Text>
                    </View>
  );

    const serviceCards = (items: [string, number][]) => (
        <View style= { styles.grid } >
        {
            items.map(([name, amount]) => (
                <View
          key= { name }
          style = {
                    [
                    styles.serviceCard,
                    { width: wide ? '31%' : '48%' },
          ]}
                >
                <Ionicons
            name="cube-outline"
            size = { 24}
            color = { TEAL }
                />
                <Text style={ styles.serviceName } > { name } </Text>
            < Text style = { styles.small } > Starting at </Text>
            < Text style = { styles.servicePrice } >
            {`$${amount}`}
        </Text>
        </View>
      ))
}
</View>
  );

const chip = (
    label: string,
    active: boolean,
    action: () => void
) => (
    <Pressable
      key= { label }
onPress = { action }
style = {
    [
    styles.chip,
    active ? styles.chipActive : null,
      ]}
    >
    <Text
        style={
    [
        styles.chipText,
        active ? styles.chipTextActive : null,
    ]
}
      >
    { label }
    </Text>
    </Pressable>
  );

return (
    <ScrollView
      ref= { scrollRef }
style = { styles.page }
contentContainerStyle = { styles.scrollContent }
keyboardShouldPersistTaps = "handled"
    >
    <View style={ styles.header }>
        <View style={ styles.brand }>
            <View style={ styles.logo }>
                <Ionicons
              name="construct-outline"
size = { 24}
color = "#FFFFFF"
    />
    </View>

    < View >
    <Text style={ styles.brandName }> RRALLC </Text>
        < Text style = { styles.brandSub } >
            HOME SERVICES
                </Text>
                </View>
                </View>

                < Pressable
style = { styles.headerButton }
onPress = {() => scrollTo('quote')}
        >
    <Text style={ styles.whiteButtonText }>
        Get a Quote
            </Text>
            </Pressable>
            </View>

            < View style = { styles.hero } >
                <View style={ styles.container }>
                    <View style={ styles.locationPill }>
                        <Ionicons
              name="location-outline"
size = { 16}
color = "#B6F2E8"
    />
    <Text style={ styles.locationText }>
        CALIFORNIA CITY & amp; MOJAVE, CA
            </Text>
            </View>

            < Text
style = {
    [
    styles.heroTitle,
    !wide ? styles.heroMobile : null,
            ]}
    >
    { 'Your home projects.\n'}
    < Text style = { styles.heroAccent } >
        Done right.
            </Text>
            </Text>

            < Text style = { styles.heroBody } >
                Furniture assembly, everyday home services,
                    and packaging cleanup.Clear estimates,
                        careful work, and no surprise add - ons.
          </Text>

                            < View style = { styles.heroButtons } >
                                <Pressable
              style={ styles.primaryButton }
onPress = {() => scrollTo('quote')}
            >
    <Text style={ styles.primaryButtonText }>
        Request a Free Quote
            </Text>
            </Pressable>

            < Pressable
style = { styles.outlineButton }
onPress = {() => scrollTo('pricing')}
            >
    <Text style={ styles.whiteButtonText }>
        View Pricing
            </Text>
            </Pressable>
            </View>

            < View style = { styles.stats } >
                <View>
                <Text style={ styles.statNumber }>
                    $80 / hr
                    </Text>
                    < Text style = { styles.statLabel } >
                        STANDARD LABOR
                            </Text>
                            </View>

                            < View >
                            <Text style={ styles.statNumber }>
                                $100
                                </Text>
                                < Text style = { styles.statLabel } >
                                    MINIMUM VISIT
                                        </Text>
                                        </View>

                                        < View >
                                        <Text style={ styles.statNumber }>
                                            2
                                            </Text>
                                            < Text style = { styles.statLabel } >
                                                LOCAL COMMUNITIES
                                                    </Text>
                                                    </View>
                                                    </View>
                                                    </View>
                                                    </View>

                                                    < View style = { styles.container } >
                                                        <View
          style={ styles.section }
{...sectionPosition('assembly') }
        >
{
    heading(
            'WHAT WE DO',
            'Furniture assembly',
            'Professional assembly for furniture of all sizes.'
    )
}

{ serviceCards(furniture) }

<Text style={ styles.note }>
    Starting labor prices.The $100 minimum
            visit applies to standalone visits.
            Multiple small items can be combined.
          </Text>
    </View>

    < View
style = { styles.section }
{...sectionPosition('home') }
        >
{
    heading(
            'MORE WAYS WE HELP',
            'Small home services',
            'Simple household projects and cleanup.'
    )
}

{ serviceCards(homeServices) }

<View style={ styles.extraBox }>
    <Text style={ styles.extraTitle }>
        Cleanup and extras
            </Text>

            < Text style = { styles.extraText } >
                Packaging cleanup: Included
                    </Text>

                    < Text style = { styles.extraText } >
                        Packaging haul - away: $20–$40
                            </Text>

                            < Text style = { styles.extraText } >
                                Oversized assembly: Custom quote
                                    </Text>

                                    < Text style = { styles.extraText } >
                                        Travel and disposal fees are quoted
                                            in advance.
            </Text>
                                            </View>
                                            </View>

                                            < View
style = { styles.section }
{...sectionPosition('pricing') }
        >
{
    heading(
            'TRANSPARENT PRICING',
            'Know the cost before we start',
            'Choose flat-rate assembly or hourly labor.'
    )
}

    < View
style = {
    [
    styles.rateRow,
    {
        flexDirection: wide ? 'row' : 'column',
    },
            ]}
    >
    <View style={ styles.rateCard }>
        <Text style={ styles.rateEyebrow }>
            HOURLY LABOR
                </Text>

                < Text style = { styles.rateNumber } >
                    $80 / hour
                    </Text>

                    < Text style = { styles.rateDescription } >
                        Additional time billed in 30 - minute
                increments at $40.
              </Text>
    </View>

    < View style = { styles.rateCard } >
        <Text style={ styles.rateEyebrow }>
            MINIMUM VISIT
                </Text>

                < Text style = { styles.rateNumber } >
                    $100
                    </Text>

                    < Text style = { styles.rateDescription } >
                        Minimum labor charge for a standalone
                visit, even under 75 minutes.
              </Text>
    </View>
    </View>

    < Text style = { styles.note } >
        Three hours of hourly labor costs $240,
            not $340.The minimum is not added on
            top of hourly labor.Flat - rate jobs
            use the agreed price.
          </Text>
    </View>

    < View
style = { styles.section }
{...sectionPosition('quote') }
        >
{
    heading(
            'GET STARTED',
            'Request your quote',
            'Select a service and tell us about your project.'
    )
}

    < View
style = {
    [
    styles.quoteLayout,
    {
        flexDirection: wide ? 'row' : 'column',
    },
            ]}
    >
    <View style={ styles.quotePanel }>
        <Text style={ styles.fieldLabel }>
            SERVICE
            </Text>

            < View style = { styles.chips } >
            {
                services.map(([name]) =>
                    chip(
                        name,
                        selected === name,
                        () => setSelected(name)
                    )
                )
            }
                </View>

                < Text style = { styles.fieldLabel } >
                    QUANTITY
                    </Text>

                    < TextInput
style = { styles.input }
value = { quantity }
onChangeText = { setQuantity }
keyboardType = "number-pad"
maxLength = { 2}
    />

    <Pressable
                style={ styles.checkRow }
onPress = {() => setHaul(!haul)}
accessibilityRole = "checkbox"
accessibilityState = {{ checked: haul }}
              >
    <Ionicons
                  name={
    haul
        ? 'checkbox'
        : 'square-outline'
}
size = { 22}
color = { TEAL }
    />

    <Text style={ styles.checkText }>
        Haul away assembly packaging
            (+$20 starting)
            </Text>
            </Pressable>

            < View style = { styles.estimateBox } >
                <Text style={ styles.estimateLabel }>
                    Illustrative starting estimate
                        </Text>

                        < Text style = { styles.estimatePrice } >
                            {`$${estimated}`}
</Text>
    </View>
    <View style = { styles.quotePanel }> 
    < Text style = { styles.note } >
        This is not a final quote.Price
                depends on project details and
                agreed scope.
              </Text>
                    </View>
                    </View>

    < View style = { styles.quotePanel } >
        <Text style={ styles.fieldLabel }>
            YOUR NAME *
                </Text>

                < TextInput
style = { styles.input }
placeholder = "Full name"
value = { customer }
onChangeText = { setCustomer }
autoCapitalize = "words"
maxLength = { 100}
    />

    <Text style={ styles.fieldLabel }>
        PHONE OR EMAIL *
            </Text>

            < TextInput
style = { styles.input }
placeholder = "Best way to reach you"
value = { contact }
onChangeText = { setContact }
autoCapitalize = "none"
maxLength = { 254}
    />

    <Text style={ styles.fieldLabel }>
        SERVICE AREA
            </Text>

            < View style = { styles.chips } >
            {
                ['California City', 'Mojave'].map(
                    (place) =>
                        chip(
                            place,
                            city === place,
                            () => setCity(place)
                        )
                )
            }
                </View>

                < Text style = { styles.fieldLabel } >
                    PROJECT DETAILS
                        </Text>

                        < TextInput
style = {
    [
    styles.input,
    styles.detailsInput,
                ]}
placeholder = "Furniture model, preferred date, special requests..."
value = { details }
onChangeText = { setDetails }
multiline
maxLength = { 2000}
    />

    <Pressable
                style={ styles.checkRow }
onPress = {() =>
setPrivacyAccepted(!privacyAccepted)
                }
accessibilityRole = "checkbox"
accessibilityState = {{
    checked: privacyAccepted,
                }}
              >
    <Ionicons
                  name={
    privacyAccepted
        ? 'checkbox'
        : 'square-outline'
}
size = { 22}
color = { TEAL }
    />

    <Text style={ styles.checkText }>
        I understand RRALLC Home Services
                  will use my contact information
                  to respond to this request.
                </Text>
    </Pressable>

    < Pressable
style = {
    [
    styles.submitButton,
    submitting
        ? styles.disabled
        : null,
                ]}
onPress = { send }
disabled = { submitting }
    >
    <Text style={ styles.whiteButtonText }>
    {
        submitting
        ? 'Submitting Request...'
            : 'Submit Quote Request'
    }
        </Text>
        </Pressable>

        < Text style = { styles.note } >
            Submission does not confirm an
                appointment or final price.
              </Text>
    </View>
    </View>
    </View>
    </View>

    < View style = { styles.footer } >
        <View style={ styles.container }>
            <Text style={ styles.footerTitle }>
                RRALLC HOME SERVICES
                    </Text>

                    < Text style = { styles.footerText } >
                        Furniture assembly • Small home
services • Cleanup
    </Text>

    < Text style = { styles.footerText } >
        California City and Mojave, California
            </Text>

            < Text style = { styles.footerFine } >
                Services are subject to California
licensing, permit, and safety
requirements.Work requiring a
            licensed contractor will not be
            accepted without appropriate licensing.
          </Text>

    < Text style = { styles.footerFine } >
        Contact information submitted through
this form is used to respond to service
inquiries.
          </Text>

    < Text style = { styles.footerFine } >
        {`© ${new Date().getFullYear()} RRALLC Home Services`}
</Text>
    </View>
    </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
    page: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    scrollContent: {
        alignItems: 'center',
    },
    container: {
        width: '100%',
        maxWidth: 1120,
        alignSelf: 'center',
        paddingHorizontal: 22,
    },
    header: {
        width: '100%',
        maxWidth: 1164,
        height: 86,
        paddingHorizontal: 22,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    brand: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    logo: {
        width: 42,
        height: 42,
        borderRadius: 12,
        backgroundColor: TEAL,
        alignItems: 'center',
        justifyContent: 'center',
    },
    brandName: {
        fontSize: 22,
        fontWeight: '900',
        color: NAVY,
    },
    brandSub: {
        fontSize: 9,
        fontWeight: '800',
        color: TEAL,
        letterSpacing: 2,
    },
    headerButton: {
        backgroundColor: TEAL,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 9,
    },
    whiteButtonText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 14,
        textAlign: 'center',
    },
    hero: {
        width: '100%',
        backgroundColor: NAVY,
        paddingTop: 70,
        paddingBottom: 55,
    },
    locationPill: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 7,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 20,
        backgroundColor: '#234B59',
    },
    locationText: {
        color: '#D9F6F2',
        fontSize: 10,
        fontWeight: '800',
    },
    heroTitle: {
        color: '#FFFFFF',
        fontSize: 48,
        lineHeight: 56,
        fontWeight: '900',
        marginTop: 22,
    },
    heroMobile: {
        fontSize: 39,
        lineHeight: 47,
    },
    heroAccent: {
        color: '#77D7C7',
    },
    heroBody: {
        color: '#C6D7DF',
        fontSize: 17,
        lineHeight: 28,
        marginTop: 18,
        maxWidth: 620,
    },
    heroButtons: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginTop: 30,
    },
    primaryButton: {
        backgroundColor: '#45B9A7',
        padding: 17,
        borderRadius: 10,
    },
    primaryButtonText: {
        color: NAVY,
        fontWeight: '900',
    },
    outlineButton: {
        borderWidth: 1,
        borderColor: '#8AA2AD',
        padding: 16,
        borderRadius: 10,
    },
    stats: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 25,
        marginTop: 55,
    },
    statNumber: {
        color: '#FFFFFF',
        fontSize: 25,
        fontWeight: '900',
    },
    statLabel: {
        color: '#A9C4CE',
        fontSize: 10,
        fontWeight: '700',
        marginTop: 5,
    },
    section: {
        paddingTop: 65,
        paddingBottom: 10,
    },
    heading: {
        marginBottom: 20,
    },
    eyebrow: {
        color: TEAL,
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: 2,
        marginBottom: 10,
    },
    h2: {
        color: NAVY,
        fontSize: 32,
        fontWeight: '900',
    },
    subtitle: {
        color: MUTED,
        fontSize: 16,
        lineHeight: 25,
        marginTop: 10,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        rowGap: 14,
    },
    serviceCard: {
        borderWidth: 1,
        borderColor: '#E0E8E9',
        borderRadius: 14,
        padding: 18,
        minHeight: 160,
        justifyContent: 'space-between',
    },
    serviceName: {
        color: NAVY,
        fontSize: 16,
        fontWeight: '800',
        marginTop: 10,
    },
    small: {
        color: MUTED,
        fontSize: 12,
    },
    servicePrice: {
        color: TEAL,
        fontSize: 22,
        fontWeight: '900',
    },
    note: {
        color: MUTED,
        fontSize: 12,
        lineHeight: 19,
        marginTop: 15,
    },
    extraBox: {
        backgroundColor: LIGHT,
        borderRadius: 14,
        padding: 20,
        marginTop: 20,
    },
    extraTitle: {
        color: NAVY,
        fontSize: 17,
        fontWeight: '900',
        marginBottom: 10,
    },
    extraText: {
        color: MUTED,
        fontSize: 14,
        lineHeight: 24,
    },
    rateRow: {
        gap: 16,
    },
    rateCard: {
        flex: 1,
        backgroundColor: LIGHT,
        padding: 25,
        borderRadius: 15,
    },
    rateEyebrow: {
        color: TEAL,
        fontWeight: '900',
        fontSize: 12,
    },
    rateNumber: {
        color: NAVY,
        fontSize: 36,
        fontWeight: '900',
        marginTop: 12,
    },
    rateDescription: {
        color: MUTED,
        fontSize: 14,
        lineHeight: 23,
        marginTop: 12,
    },
    quoteLayout: {
        gap: 20,
    },
    quotePanel: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#DDE7E8',
        borderRadius: 16,
        padding: 22,
    },
    fieldLabel: {
        color: NAVY,
        fontSize: 11,
        fontWeight: '900',
        marginTop: 12,
        marginBottom: 10,
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 7,
        marginBottom: 12,
    },
    chip: {
        borderWidth: 1,
        borderColor: '#C9D8D9',
        borderRadius: 8,
        paddingHorizontal: 11,
        paddingVertical: 9,
    },
    chipActive: {
        backgroundColor: TEAL,
        borderColor: TEAL,
    },
    chipText: {
        color: NAVY,
        fontSize: 12,
        fontWeight: '700',
    },
    chipTextActive: {
        color: '#FFFFFF',
    },
    input: {
        borderWidth: 1,
        borderColor: '#CFDDDF',
        borderRadius: 9,
        padding: 13,
        fontSize: 15,
        color: NAVY,
        marginBottom: 8,
    },
    detailsInput: {
        height: 112,
        textAlignVertical: 'top',
    },
    checkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 12,
    },
    checkText: {
        color: NAVY,
        fontSize: 13,
        flex: 1,
        lineHeight: 20,
    },
    estimateBox: {
        borderTopWidth: 1,
        borderColor: '#DDE7E8',
        marginTop: 20,
        paddingTop: 18,
    },
    estimateLabel: {
        color: MUTED,
        fontSize: 13,
    },
    estimatePrice: {
        color: TEAL,
        fontSize: 38,
        fontWeight: '900',
        marginTop: 5,
    },
    submitButton: {
        backgroundColor: TEAL,
        padding: 17,
        borderRadius: 10,
        alignItems: 'center',
        marginTop: 18,
    },
    disabled: {
        opacity: 0.6,
    },
    footer: {
        width: '100%',
        backgroundColor: NAVY,
        marginTop: 70,
        paddingVertical: 45,
    },
    footerTitle: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: '900',
    },
    footerText: {
        color: '#D0E0E5',
        fontSize: 14,
        marginTop: 9,
    },
    footerFine: {
        color: '#A6BBC5',
        fontSize: 11,
        lineHeight: 18,
        marginTop: 20,
    },
});
