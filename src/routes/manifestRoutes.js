import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, FlatList, Platform,
  KeyboardAvoidingView, Modal, ScrollView, useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import StudentManifestRowPremium from '../components/StudentManifestRowPremium';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/EnhancedThemeContext';
import ScreenWrapper from '../components/ScreenWrapper';
import GlobalHeader from '../components/GlobalHeader';
import { ManifestSkeleton } from '../components/ShimmerLoader';
import { PremiumBentoGrid, PremiumBentoCard } from '../components/LiquidGlass';
import SocketService from '../services/SocketService';
import { locationService } from '../services/locationService';
import { pickScreenBackground } from '../constants/brandAssets';
import BoardingModal from '../features/transit/BoardingModal';
import AdHocEnrollModal from '../features/transit/AdHocEnrollModal';
import { safeSearchValue } from '../features/security/inputSanitizer';
import { useNotifications } from '../context/NotificationContext';
import {
  getStudents,
  getParents,
  boardStudent,
  dropOffStudent,
  triggerPanicAlert,
} from '../services/apiService';

let ManifestList = FlatList;
if (Platform.OS !== 'web') {
  try { ManifestList = require('@shopify/flash-list').FlashList; } catch (_) {}
}

const BP_TABLET  = 768;
const BP_DESKTOP = 1024;

function fuzzyMatch(haystack, needle) {
  const h = (haystack || '').toLowerCase();
  const n = needle.toLowerCase();
  let hi = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const found = h.indexOf(n[ni], hi);
    if (found === -1) return false;
    hi = found + 1;
  }
  return true;
}

const PANIC_SUGGESTIONS = [
  'Student injury on board',
  'Medical emergency',
  'Vehicle breakdown',
  'Route hazard / unsafe road',
  'Student missing',
  'Fight on bus',
  'Unsafe driver behavior',
  'Bus stopped / stranded',
];

// ── Normalise a student record from the backend into the manifest shape ───────
function toManifestRow(s) {
  // Backend returns: student.parent.user.name (nested through Parent → User)
  const parentUser = s.parent?.user ?? null;
  return {
    // Identity
    id:           String(s.id),
    name:         s.name || 'Unknown',
    grade:        s.grade || '—',
    stop:         s.stop || s.dropOffPoint || '',
    avatar:       s.avatar || '👤',
    parentName:   parentUser?.name  || s.parentName  || '',
    parentPhone:  parentUser?.phone || s.parentPhone || '',
    // Boarding tracking (local session state)
    onboardTimestamp:  null,
    offboardTimestamp: null,
    isBoarded:         false,
    isDroppedOff:      false,
    preVerified:       false,
    // Stores the manifest record ID returned by POST /manifests
    // so we can call PUT /manifests/:manifestId for drop-off
    manifestId:        null,
  };
}

export default function BusAssistantScreen({ navigation, route }) {
  const { token, user } = useAuth();
  const { t, scaled, isDarkMode, announceText, haptic, colors } = useTheme();
  const busUnread = useNotifications().getUnreadCountForRole('Bus Assistant');

  const { width: winWidth } = useWindowDimensions();
  const isTablet  = winWidth >= BP_TABLET;
  const isDesktop = winWidth >= BP_DESKTOP;
  const rp = isDesktop ? 28 : isTablet ? 20 : 16;
  const fabHeight = isTablet ? 62 : 54;
  const statFontSize = scaled(isTablet ? 40 : 34);

  // ── Core state ────────────────────────────────────────────────────
  const [currentSession, setCurrentSession] = useState('morning');
  const [searchQuery, setSearchQuery]       = useState('');
  const [manifesto, setManifesto]           = useState([]);
  const [isLoading, setIsLoading]           = useState(true);
  const [loadError, setLoadError]           = useState(null);
  const [parents, setParents]               = useState([]);

  // The bus this assistant is assigned to (resolved on mount)
  const busIdRef = useRef(null);

  const busAssistant = route.params?.busAssistant || {
    name: user?.name || 'Assistant',
    role: 'Lead Assistant',
  };

  // ── Modal state ───────────────────────────────────────────────────
  const [boardingModal, setBoardingModal] = useState({
    visible: false, student: null, actionType: null,
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [panicModal, setPanicModal]     = useState({ visible: false, studentId: null });
  const [panicComment, setPanicComment] = useState('');
  const [panicSuggestion, setPanicSuggestion] = useState('');

  // ── Load students, bus assignment, and parents from the backend ───
  useEffect(() => {
    announceText(t('welcome') + ', ' + busAssistant.name.split(' ')[0]);
    if (token) {
      locationService.connect(token);
      SocketService.getInstance().connect(token);
    }

    const load = async () => {
      setIsLoading(true);
      setLoadError(null);

      try {
        // 1. Fetch students and parents in parallel
        //    GET /students already includes the full bus + assistant objects
        //    so we don't need a separate GET /buses call.
        const [studentsRes, parentsRes] = await Promise.all([
          getStudents(),
          getParents(),
        ]);

        if (!studentsRes.success) throw new Error(studentsRes.error || 'Failed to load students');

        // 2. Pull all students for this tenant
        const students = Array.isArray(studentsRes.data)
          ? studentsRes.data
          : studentsRes.data?.data ?? [];

        // 3. Filter to only students whose bus has THIS assistant assigned.
        //    Backend shape: student.bus.assistant.id  (nested User object)
        //    Fallback: student.bus.assistantId        (flat FK — also present in Prisma response)
        const myStudents = students.filter(s => {
          const nestedId = s.bus?.assistant?.id;
          const flatId   = s.bus?.assistantId;
          return (
            String(nestedId) === String(user?.id) ||
            String(flatId)   === String(user?.id)
          );
        });

        // Store the busId for manifest POST calls
        if (myStudents.length > 0) {
          busIdRef.current = myStudents[0].busId ?? myStudents[0].bus?.id ?? null;
        }

        setManifesto(myStudents.map(toManifestRow));

        // 4. Populate parent list for AdHoc modal
        //    Backend shape: parent.user.name / parent.user.phone
        if (parentsRes.success) {
          const pArr = Array.isArray(parentsRes.data) ? parentsRes.data : parentsRes.data?.data ?? [];
          setParents(pArr.map(p => ({
            id:    String(p.id),
            name:  p.user?.name  || p.name  || '',
            phone: p.user?.phone || p.phone || '',
            email: p.user?.email || p.email || '',
          })));
        }
      } catch (err) {
        console.error('[BusAssistant] load error:', err);
        setLoadError(err.message || 'Could not load student list');
      } finally {
        setIsLoading(false);
      }
    };

    load();

    return () => {
      locationService.disconnect();
    };
  }, [token, user?.id]);

  // ── Search ────────────────────────────────────────────────────────
  const handleSearch = useCallback((raw) => setSearchQuery(safeSearchValue(raw)), []);

  const filteredManifest = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return manifesto;
    return manifesto.filter(s =>
      fuzzyMatch(s.name,  q) ||
      fuzzyMatch(s.grade, q) ||
      fuzzyMatch(s.stop,  q) ||
      s.id.toLowerCase().includes(q.toLowerCase())
    );
  }, [manifesto, searchQuery]);

  const sortedManifest = useMemo(() => {
    if (currentSession !== 'evening') return filteredManifest;
    return [...filteredManifest].sort((a, b) => {
      if (a.preVerified && !b.preVerified) return -1;
      if (!a.preVerified && b.preVerified) return  1;
      return 0;
    });
  }, [filteredManifest, currentSession]);

  // ── Stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:       manifesto.length,
    active:      manifesto.filter(s => s.isBoarded && !s.isDroppedOff).length,
    completed:   manifesto.filter(s => s.isDroppedOff).length,
    preVerified: manifesto.filter(s => s.preVerified).length,
    pending: currentSession === 'evening'
      ? manifesto.filter(s => !s.preVerified && !s.isBoarded && !s.isDroppedOff).length
      : 0,
  }), [manifesto, currentSession]);

  // ── Session switch ────────────────────────────────────────────────
  const switchSession = useCallback((next) => {
    haptic.selection();
    if (next === 'evening' && currentSession === 'morning') {
      const attended = new Set(manifesto.filter(s => s.isBoarded).map(s => s.id));
      setManifesto(prev => prev.map(s => ({
        ...s,
        onboardTimestamp: null, offboardTimestamp: null,
        isBoarded: false, isDroppedOff: false,
        preVerified: attended.has(s.id),
        manifestId: null,
      })));
    } else {
      setManifesto(prev => prev.map(s => ({
        ...s,
        onboardTimestamp: null, offboardTimestamp: null,
        isBoarded: false, isDroppedOff: false,
        preVerified: false,
        manifestId: null,
      })));
    }
    setCurrentSession(next);
  }, [currentSession, manifesto, haptic]);

  // ── 2-Step Boarding: open modal — action determined by student state ─────────
  const requestBoarding = useCallback((student, actionType) => {
    // If already boarded and not yet dropped off, force dropoff action
    const resolvedAction = student.isBoarded && !student.isDroppedOff ? 'dropoff' : actionType;
    setBoardingModal({ visible: true, student, actionType: resolvedAction });
  }, []);

  // ── 2-Step Boarding: confirm → hit the backend ────────────────────
  const confirmBoarding = useCallback(async () => {
    const { student, actionType } = boardingModal;
    if (!student) return;

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const busName = student.busName || `Bus #${busIdRef.current}`;

    if (actionType === 'board' || actionType === 'manual') {
      const res = await boardStudent({
        studentId:   student.id,
        busId:       busIdRef.current,
        assistantId: user?.id,
        session:     currentSession,
      });

      if (!res.success) {
        Alert.alert('Boarding Failed', res.error || 'Could not record boarding. Please try again.');
        setBoardingModal({ visible: false, student: null, actionType: null });
        return;
      }

      const newManifestId = res.data?.id ?? res.data?.manifestId ?? null;

      setManifesto(prev => prev.map(s =>
        s.id !== student.id ? s : {
          ...s,
          onboardTimestamp: now,
          isBoarded:        true,
          isDroppedOff:     false,
          manifestId:       newManifestId,
        }
      ));

      // Emit socket event with full details so NotificationContext notifies parent
      SocketService.getInstance().send('student_boarded', {
        studentId:   Number(student.id),
        studentName: student.name,
        busName,
        busId:       busIdRef.current,
        timestamp:   now,
        session:     currentSession,
        parentPhone: student.parentPhone,
      });

    } else if (actionType === 'dropoff') {
      if (!student.manifestId) {
        Alert.alert('Drop-off Error', 'No boarding record found. Student must be boarded first.');
        setBoardingModal({ visible: false, student: null, actionType: null });
        return;
      }

      const res = await dropOffStudent(student.manifestId);

      if (!res.success) {
        Alert.alert('Drop-off Failed', res.error || 'Could not record drop-off. Please try again.');
        setBoardingModal({ visible: false, student: null, actionType: null });
        return;
      }

      setManifesto(prev => prev.map(s =>
        s.id !== student.id ? s : {
          ...s,
          offboardTimestamp: now,
          isDroppedOff:      true,
        }
      ));

      // Emit socket event so parent's NotificationContext shows drop-off notification
      SocketService.getInstance().send('student_offboarded', {
        studentId:   Number(student.id),
        studentName: student.name,
        busName,
        busId:       busIdRef.current,
        timestamp:   now,
        session:     currentSession,
        stopName:    student.stop || '',
        parentPhone: student.parentPhone,
      });
    }

    setBoardingModal({ visible: false, student: null, actionType: null });
    announceText(
      `${student.name} ${actionType === 'dropoff'
        ? (t('dropped_off') || 'dropped off')
        : (t('boarded')     || 'boarded')}`
    );
  }, [boardingModal, currentSession, user?.id, t, announceText]);

  // ── Bulk action ───────────────────────────────────────────────────
  const handleBulkAction = async () => {
    await haptic.heavy();
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (currentSession === 'morning') {
      // Drop-off all currently-boarded students
      const toDropOff = manifesto.filter(s => s.isBoarded && !s.isDroppedOff);

      await Promise.allSettled(
        toDropOff
          .filter(s => s.manifestId)
          .map(s => dropOffStudent(s.manifestId))
      );

      setManifesto(prev => prev.map(s =>
        s.isBoarded && !s.isDroppedOff
          ? { ...s, offboardTimestamp: now, isDroppedOff: true }
          : s
      ));
      haptic.success();
      Alert.alert(
        t('arrival_school') || 'School Arrival',
        t('all_students_arrived') || 'All onboarded students have been checked into school.'
      );
    } else {
      const pendingPreVerified = manifesto.filter(s => s.preVerified && !s.isBoarded);
      if (pendingPreVerified.length === 0) {
        Alert.alert(
          t('no_pre_verified') || 'No Pre-Verified Students',
          'All morning attendees are already onboarded, or none were recorded.'
        );
        return;
      }

      // Board all pre-verified students
      const results = await Promise.allSettled(
        pendingPreVerified.map(s =>
          boardStudent({
            studentId:   s.id,
            busId:       busIdRef.current,
            assistantId: user?.id,
            session:     currentSession,
          })
        )
      );

      setManifesto(prev => prev.map(s => {
        if (!s.preVerified || s.isBoarded) return s;
        const idx  = pendingPreVerified.findIndex(p => p.id === s.id);
        const res  = results[idx];
        const mId  = res?.status === 'fulfilled' && res.value?.success
          ? (res.value.data?.id ?? res.value.data?.manifestId ?? null)
          : null;
        return { ...s, onboardTimestamp: now, isBoarded: true, manifestId: mId };
      }));

      haptic.success();
      Alert.alert(
        t('departure_school') || 'Evening Departure',
        `${pendingPreVerified.length} pre-verified student(s) registered for departure.`
      );
    }
  };

  // ── Panic — hits backend then broadcasts via Socket ───────────────
  const handlePanic = useCallback(async (studentId) => {
    await haptic.heavy();
    setPanicComment('');
    setPanicSuggestion('');
    setPanicModal({ visible: true, studentId });
  }, [haptic]);

  const confirmPanic = useCallback(async () => {
    await haptic.heavy();
    haptic.error();
    const { studentId } = panicModal;
    const student = manifesto.find(s => s.id === studentId);
    const target  = studentId === 'ALL' ? 'FLEET' : student?.name || 'Unknown';

    setPanicModal({ visible: false, studentId: null });

    // Call the real backend
    if (studentId !== 'ALL' && student) {
      await triggerPanicAlert({
        childId:     studentId,
        phoneNumber: student.parentPhone || '',
      });
    }

    // Also broadcast over the socket for real-time admin dashboards
    SocketService.getInstance().send('panic_alert', {
      studentId,
      target,
      comment:   panicComment.trim() || 'No comment provided',
      timestamp: new Date().toISOString(),
    });

    Alert.alert(
      t('sos_activated') || 'SOS ACTIVATED',
      t('emergency_msg') ||
        'Emergency protocol triggered. School admin and all relevant parents have been notified.'
    );
  }, [panicModal, panicComment, manifesto, haptic, t]);

  // ── Ad-Hoc Enrollment ─────────────────────────────────────────────
  const handleAdHocEnroll = useCallback((newStudent) => {
    setManifesto(prev => [newStudent, ...prev]);
    setShowAddModal(false);
    announceText(`${newStudent.name} ${t('added_to_manifest') || 'added to manifest'}`);
  }, [announceText, t]);

  // ── Header ────────────────────────────────────────────────────────
  const renderHeader = () => {
    const controlsDirection = isTablet ? 'row' : 'column';

    return (
      <View style={[styles.headerContent, { paddingHorizontal: rp }]}>
        <PremiumBentoGrid columns={12} gap={isTablet ? 16 : 12}>

          <PremiumBentoCard span={12} mode="hero" isDark={isDarkMode}>
            <Text style={[styles.welcomeTitle, { color: colors.text, fontSize: scaled(isDesktop ? 30 : isTablet ? 26 : 22) }]}>
              {t('welcome_assistant', { name: busAssistant.name.split(' ')[0] })}
            </Text>
            <Text style={[styles.welcomeSub, { color: colors.textSecondary, fontSize: scaled(isTablet ? 15 : 13) }]}>
              {currentSession === 'morning'
                ? t('morning_session_active') || '🌅 Morning Session Active'
                : t('evening_session_active') || '🌇 Evening Session Active'}
              {busIdRef.current ? `  ·  Bus #${busIdRef.current}` : ''}
            </Text>
            <View style={[styles.accentLine, { backgroundColor: colors.accent }]} />
            <View style={styles.trustRow}>
              <Feather name="lock" size={12} color={colors.success} />
              <Text style={[styles.trustText, { color: colors.success, fontSize: scaled(11) }]}>
                {t('secure_session') || 'Secure Session'} · Live Backend
              </Text>
            </View>
          </PremiumBentoCard>

          {/* Load error banner */}
          {loadError && (
            <PremiumBentoCard span={12} mode="standard" isDark={isDarkMode}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name="wifi-off" size={16} color={colors.danger} />
                <Text style={{ color: colors.danger, fontWeight: '700', flex: 1, fontSize: scaled(13) }}>
                  {loadError}
                </Text>
                <TouchableOpacity onPress={() => { setLoadError(null); setIsLoading(true); }}>
                  <Feather name="refresh-cw" size={16} color={colors.primary} />
                </TouchableOpacity>
              </View>
            </PremiumBentoCard>
          )}

          <PremiumBentoCard span={6} mode="standard" isDark={isDarkMode}>
            <Text style={[styles.statLabel, { color: colors.textTertiary, fontSize: scaled(10) }]}>
              {t('active_commuters') || 'ACTIVE'}
            </Text>
            <Text style={[styles.statValue, { color: colors.primary, fontSize: statFontSize }]}>
              {stats.active}
            </Text>
            <Text style={[styles.statSub, { color: colors.textSecondary, fontSize: scaled(12) }]}>
              {t('students_onboard') || 'Onboard'}
            </Text>
          </PremiumBentoCard>

          <PremiumBentoCard span={6} mode="standard" isDark={isDarkMode}>
            <Text style={[styles.statLabel, { color: colors.textTertiary, fontSize: scaled(10) }]}>
              {t('completed') || 'ARRIVED'}
            </Text>
            <Text style={[styles.statValue, { color: colors.success, fontSize: statFontSize }]}>
              {stats.completed}
            </Text>
            <Text style={[styles.statSub, { color: colors.textSecondary, fontSize: scaled(12) }]}>
              {t('safe_delivery') || 'Safe Delivery'}
            </Text>
          </PremiumBentoCard>

          {currentSession === 'evening' && (
            <>
              <PremiumBentoCard span={isTablet ? 3 : 6} mode="standard" isDark={isDarkMode}>
                <Text style={[styles.statLabel, { color: colors.textTertiary, fontSize: scaled(10) }]}>
                  PRE-VERIFIED
                </Text>
                <Text style={[styles.statValue, { color: colors.accent, fontSize: statFontSize }]}>
                  {stats.preVerified}
                </Text>
                <Text style={[styles.statSub, { color: colors.textSecondary, fontSize: scaled(11) }]}>
                  Morning
                </Text>
              </PremiumBentoCard>

              <PremiumBentoCard span={isTablet ? 3 : 6} mode="standard" isDark={isDarkMode}>
                <Text style={[styles.statLabel, { color: colors.textTertiary, fontSize: scaled(10) }]}>
                  PENDING
                </Text>
                <Text style={[styles.statValue, {
                  color: stats.pending > 0 ? (colors.warning || '#F59E0B') : colors.success,
                  fontSize: statFontSize,
                }]}>
                  {stats.pending}
                </Text>
                <Text style={[styles.statSub, { color: colors.textSecondary, fontSize: scaled(11) }]}>
                  Absent AM
                </Text>
              </PremiumBentoCard>
            </>
          )}
        </PremiumBentoGrid>

        {/* Search + Session Toggle */}
        <View style={[styles.controlsRow, {
          flexDirection: controlsDirection,
          marginTop: isTablet ? 20 : 16,
          gap: isTablet ? 12 : 10,
        }]}>
          <View style={[styles.searchBox, {
            flex: isTablet ? 1 : undefined,
            backgroundColor: colors.surfaceLight,
            borderColor: colors.border,
            height: isTablet ? 52 : 48,
          }]}>
            <Feather name="search" size={18} color={colors.textTertiary} />
            <TextInput
              style={[styles.searchInput, { color: colors.text, fontSize: scaled(isTablet ? 15 : 14) }]}
              placeholder={isTablet
                ? (t('search_manifest') || 'Search by name, grade, or stop…')
                : (t('search_short')    || 'Search manifest…')}
              placeholderTextColor={colors.textTertiary}
              value={searchQuery}
              onChangeText={handleSearch}
              autoCorrect={false}
              autoCapitalize="none"
              maxLength={80}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x-circle" size={17} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          <View style={[styles.sessionToggle, {
            backgroundColor: colors.surfaceLight,
            width: isTablet ? 240 : '100%',
            alignSelf: isTablet ? 'flex-start' : 'auto',
          }]}>
            {['morning', 'evening'].map((sess) => {
              const active = currentSession === sess;
              const bg     = sess === 'morning' ? colors.primary : colors.accent;
              return (
                <TouchableOpacity
                  key={sess}
                  style={[styles.toggleBtn, active && { backgroundColor: bg }, { height: isTablet ? 44 : 40 }]}
                  onPress={() => switchSession(sess)}
                >
                  <Feather name={sess === 'morning' ? 'sunrise' : 'sunset'} size={13}
                    color={active ? '#FFF' : colors.textSecondary} />
                  <Text style={[styles.toggleText, {
                    color: active ? '#FFF' : colors.textSecondary,
                    fontSize: scaled(13),
                  }]}>
                    {sess === 'morning' ? (t('morning') || 'Morning') : (t('evening') || 'Evening')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {currentSession === 'evening' && stats.pending > 0 && (
          <View style={[styles.eveningBanner, {
            backgroundColor: colors.accent + '18',
            borderColor: colors.accent + '40',
            marginTop: isTablet ? 16 : 12,
          }]}>
            <Feather name="info" size={14} color={colors.accent} />
            <Text style={[styles.eveningBannerText, { color: colors.accent, fontSize: scaled(isTablet ? 13 : 12) }]}>
              {stats.pending} student(s) were absent this morning. Tap "Manual" on their row, or use + to add them.
            </Text>
          </View>
        )}

        {currentSession === 'evening' && stats.preVerified === 0 && !isLoading && (
          <View style={[styles.eveningBanner, {
            backgroundColor: colors.primary + '12',
            borderColor: colors.primary + '30',
            marginTop: isTablet ? 16 : 12,
          }]}>
            <Feather name="moon" size={14} color={colors.primary} />
            <Text style={[styles.eveningBannerText, { color: colors.primary, fontSize: scaled(12) }]}>
              No morning boarding data found. Switch to Morning session first, board students, then return to Evening.
            </Text>
          </View>
        )}

        {isLoading && (
          <View style={[styles.skeletonBox, { marginTop: isTablet ? 28 : 20 }]}>
            <ActivityIndicator size="small" color={colors.primary} style={{ marginBottom: 8 }} />
            <ManifestSkeleton />
            <ManifestSkeleton />
          </View>
        )}
      </View>
    );
  };

  const showFabLabel = winWidth >= 360;
  const dashBg = pickScreenBackground(3);

  return (
    <ScreenWrapper backgroundImage={dashBg} contentContainerStyle={styles.scrollRoot}>
      <GlobalHeader
        user={{ name: busAssistant.name, role: t('bus_assistant_role') || 'Lead Assistant' }}
        onLogout={() => navigation.replace('Logout')}
        onNotifications={() => navigation.navigate('NotificationCenter', { role: 'Bus Assistant' })}
        notificationCount={busUnread}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ManifestList
          data={sortedManifest}
          keyExtractor={(item) => item.id}
          estimatedItemSize={88}
          drawDistance={500}
          ListHeaderComponent={renderHeader}
          renderItem={({ item }) => (
            <StudentManifestRowPremium
              student={item}
              session={currentSession}
              isOnboarded={item.isBoarded}
              isOffboarded={item.isDroppedOff}
              preVerified={item.preVerified}
              isAdHoc={!!item.isAdHoc}
              // After boarding: only offboard is available
              // Before boarding: board (or manual for evening)
              onBoard={()         => requestBoarding(item, 'board')}
              onOffboard={()      => requestBoarding(item, 'dropoff')}
              onManualOnboard={() => requestBoarding(item, 'manual')}
              onPanic={()         => handlePanic(item.id)}
            />
          )}
          contentContainerStyle={[
            styles.listContent,
            { paddingHorizontal: rp, paddingBottom: fabHeight + 60 },
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            !isLoading && (
              <Text style={[styles.emptyText, { color: colors.textTertiary, fontSize: scaled(15) }]}>
                {loadError
                  ? 'Could not load students. Check your connection.'
                  : (t('no_students_found') || 'No students found on this manifest.')}
              </Text>
            )
          }
        />
      </KeyboardAvoidingView>

      {/* ── Floating Action Bar ── */}
      <View style={[styles.actionFab, {
        backgroundColor: colors.surface,
        borderTopColor: colors.border,
        padding: rp,
        paddingBottom: Platform.OS === 'ios' ? 34 : rp,
      }]}>
        <TouchableOpacity
          style={[styles.bulkAction, {
            backgroundColor: currentSession === 'morning' ? colors.success : colors.primary,
            height: fabHeight,
          }]}
          onPress={handleBulkAction}
          activeOpacity={0.8}
          {...(Platform.OS === 'android' ? { filterTouchesWhenObscured: true } : {})}
        >
          <Feather name={currentSession === 'morning' ? 'check-circle' : 'play-circle'}
            size={isTablet ? 22 : 18} color="#FFF" />
          {showFabLabel && (
            <Text style={[styles.bulkText, { fontSize: scaled(isTablet ? 16 : 14) }]}>
              {currentSession === 'morning'
                ? (t('offboard_all')         || 'Offboard All')
                : (t('onboard_pre_verified') || 'Onboard Pre-Verified')}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.squareFab, { backgroundColor: colors.accent, width: fabHeight, height: fabHeight }]}
          onPress={() => setShowAddModal(true)}
        >
          <Feather name="plus" size={isTablet ? 24 : 20} color="#FFF" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.squareFab, { borderColor: colors.danger, borderWidth: 2, width: fabHeight, height: fabHeight }]}
          onPress={() => handlePanic('ALL')}
          {...(Platform.OS === 'android' ? { filterTouchesWhenObscured: true } : {})}
        >
          <Feather name="alert-triangle" size={isTablet ? 24 : 20} color={colors.danger} />
        </TouchableOpacity>
      </View>

      {/* ── 2-Step Boarding Modal ── */}
      <BoardingModal
        visible={boardingModal.visible}
        student={boardingModal.student}
        session={currentSession}
        actionType={boardingModal.actionType}
        onConfirm={confirmBoarding}
        onCancel={() => setBoardingModal({ visible: false, student: null, actionType: null })}
      />

      {/* ── Ad-Hoc Enrollment Modal (receives real parents from API) ── */}
      <AdHocEnrollModal
        visible={showAddModal}
        session={currentSession}
        parents={parents}
        onEnroll={handleAdHocEnroll}
        onCancel={() => setShowAddModal(false)}
      />

      {/* ── Panic Confirmation Modal ── */}
      <Modal
        visible={panicModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setPanicModal({ visible: false, studentId: null })}
        statusBarTranslucent
      >
        <View style={styles.panicOverlay}>
          <View style={[styles.panicCard, {
            backgroundColor: colors.surface,
            borderColor: colors.danger + '55',
            width: isTablet ? 420 : '92%',
            padding: isTablet ? 40 : 28,
          }]}>
            <View style={[styles.panicIconRing, { borderColor: colors.danger + '55' }]}>
              <Feather name="alert-octagon" size={isTablet ? 44 : 36} color={colors.danger} />
            </View>

            <Text style={[styles.panicTitle, { color: colors.danger, fontSize: scaled(isTablet ? 24 : 20) }]}>
              {t('panic_sos') || 'EMERGENCY SOS'}
            </Text>

            <Text style={[styles.panicSubtitle, { color: colors.textSecondary, fontSize: scaled(isTablet ? 15 : 13) }]}>
              {panicModal.studentId === 'ALL'
                ? 'This will broadcast an emergency alert to ALL parents and school administration. Are you sure?'
                : 'This will send an emergency alert for this student. Are you sure?'}
            </Text>

            <View style={[styles.panicCommentSection, { width: '100%' }]}>
              <Text style={[styles.panicSuggestionTitle, { color: colors.textTertiary, fontSize: scaled(11) }]}>
                QUICK REASONS
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
                style={{ marginBottom: 12 }}
              >
                {PANIC_SUGGESTIONS.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.suggestionChip, {
                      backgroundColor: panicSuggestion === s ? colors.danger + '20' : colors.surfaceLight,
                      borderColor: panicSuggestion === s ? colors.danger : colors.border,
                    }]}
                    onPress={() => { haptic.selection(); setPanicSuggestion(s); setPanicComment(s); }}
                  >
                    <Text style={[styles.suggestionChipText, {
                      color: panicSuggestion === s ? colors.danger : colors.textSecondary,
                      fontSize: scaled(12),
                    }]}>
                      {s}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TextInput
                style={[styles.panicCommentInput, {
                  borderColor: colors.border,
                  backgroundColor: colors.surfaceLight,
                  color: colors.text,
                  fontSize: scaled(14),
                }]}
                placeholder="Or describe what's happening..."
                placeholderTextColor={colors.textTertiary}
                value={panicComment}
                onChangeText={(v) => { setPanicComment(v); setPanicSuggestion(''); }}
                multiline
                numberOfLines={2}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.panicActions}>
              <TouchableOpacity
                style={[styles.panicCancelBtn, { borderColor: colors.border, height: isTablet ? 56 : 50 }]}
                onPress={() => setPanicModal({ visible: false, studentId: null })}
              >
                <Text style={[styles.panicCancelText, { color: colors.textSecondary, fontSize: scaled(14) }]}>
                  {t('cancel') || 'Cancel'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.panicActivateBtn, { backgroundColor: colors.danger, height: isTablet ? 56 : 50 }]}
                onPress={confirmPanic}
                {...(Platform.OS === 'android' ? { filterTouchesWhenObscured: true } : {})}
              >
                <Feather name="radio" size={isTablet ? 20 : 17} color="#FFF" />
                <Text style={[styles.panicActivateText, { fontSize: scaled(14) }]}>
                  {t('activate') || 'ACTIVATE SOS'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scrollRoot:    { flexGrow: 1 },
  listContent:   { paddingTop: 8 },
  headerContent: { marginBottom: 24, paddingTop: 8 },
  welcomeTitle:  { fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 },
  welcomeSub:    { fontWeight: '600', opacity: 0.8 },
  accentLine:    { width: 40, height: 4, borderRadius: 2, marginTop: 14, marginBottom: 10 },
  trustRow:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trustText:     { fontWeight: '700' },
  statLabel:     { fontWeight: '900', textTransform: 'uppercase', marginBottom: 10, letterSpacing: 1 },
  statValue:     { fontWeight: '900', letterSpacing: -1 },
  statSub:       { fontWeight: '700', marginTop: 4 },
  controlsRow:   { gap: 10 },
  searchBox:     { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, gap: 10 },
  searchInput:   { flex: 1, fontWeight: '600' },
  sessionToggle: { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4 },
  toggleBtn:     { flex: 1, borderRadius: 11, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 5 },
  toggleText:    { fontWeight: '800' },
  eveningBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, borderWidth: 1, padding: 14 },
  eveningBannerText: { flex: 1, fontWeight: '600', lineHeight: 18 },
  skeletonBox:   { gap: 10 },
  emptyText:     { textAlign: 'center', marginTop: 40, fontWeight: '600' },
  actionFab:     { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', borderTopWidth: 1, gap: 10, alignItems: 'center', zIndex: 100 },
  bulkAction:    { flex: 1, borderRadius: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, elevation: 4 },
  bulkText:      { color: '#FFF', fontWeight: '900', letterSpacing: 0.3 },
  squareFab:     { borderRadius: 18, justifyContent: 'center', alignItems: 'center', elevation: 3 },
  panicOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.84)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  panicCard:     { borderRadius: 28, borderWidth: 1.5, alignItems: 'center', elevation: 20 },
  panicIconRing: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, justifyContent: 'center', alignItems: 'center', marginBottom: 18 },
  panicTitle:    { fontWeight: '900', letterSpacing: 1, marginBottom: 10, textAlign: 'center' },
  panicSubtitle: { fontWeight: '600', textAlign: 'center', lineHeight: 21, marginBottom: 16 },
  panicCommentSection: { marginBottom: 16 },
  panicSuggestionTitle: { fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  suggestionChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  suggestionChipText: { fontWeight: '700' },
  panicCommentInput: { borderWidth: 1, borderRadius: 14, padding: 12, minHeight: 64, fontWeight: '600', lineHeight: 20 },
  panicActions:  { flexDirection: 'row', gap: 10, width: '100%' },
  panicCancelBtn: { flex: 1, borderRadius: 14, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  panicCancelText: { fontWeight: '800' },
  panicActivateBtn: { flex: 2, borderRadius: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, elevation: 6 },
  panicActivateText: { color: '#FFF', fontWeight: '900', letterSpacing: 0.4 },
});