import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  LayoutAnimation,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../navigation';
import {
  TodoItem,
  TodoPriority,
  getTodos,
  insertTodo,
  updateTodo,
  setTodoDone,
  removeTodo,
} from '../db';
import EditTodoModal from '../components/EditTodoModal';
import { AnimatedSwap, FadeSlideIn, PressableScale, Shimmer } from '../components/ui/motion';
import { CloseIcon } from '../components/ui/icons';
import {
  motion,
  radius,
  space,
  Theme,
  type,
  useTheme,
  useThemedStyles,
} from '../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Props = NativeStackScreenProps<RootStackParamList, 'Todo'>;

/** Total hold duration to open secret chat (20 seconds). */
const SECRET_HOLD_MS = 20000;
/** Time before progress ring starts showing (12 seconds). */
const PROGRESS_START_MS = 12000;
/** Duration of progress ring fill (from 12s to 20s = 8 seconds). */
const PROGRESS_DURATION_MS = 8000;

/**
 * Second, faster way in: tap the screen title this many times…
 *
 * Deliberately gives no feedback of any kind — no ripple, no scale, no
 * haptic, no progress. A hidden door that acknowledges being knocked on
 * isn't hidden, and the whole point of this screen is to look like an
 * ordinary task list to anyone else holding the phone.
 */
const TITLE_TAP_COUNT = 5;
/** …with all of them landing inside this rolling window. */
const TITLE_TAP_WINDOW_MS = 2000;

/**
 * Priority reads as contrast against the canvas, not hue — the loudest
 * marker is the most urgent, in both light and dark mode.
 */
const priorityTone = (t: Theme, p: TodoPriority) =>
  ({ high: t.severity.critical, medium: t.severity.high, low: t.severity.muted }[p]);

const PRIORITY_LABEL: Record<TodoPriority, string> = {
  high: 'HIGH',
  medium: 'MED',
  low: 'LOW',
};

const FILTER_OPTIONS = ['All', 'Work', 'Personal', 'Health', 'Shopping', 'Other'];

/* ── Animated checkbox ─────────────────────────────────────────────────────
   Fills and pops when checked; the tick draws in behind a spring. */

function Checkbox({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  const styles = useThemedStyles(createStyles);
  const fill = useRef(new Animated.Value(done ? 1 : 0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const mounted = useRef(false);

  useEffect(() => {
    Animated.timing(fill, {
      toValue: done ? 1 : 0,
      duration: motion.duration.fast,
      easing: motion.easing.out,
      useNativeDriver: true,
    }).start();

    // Skip the celebratory pop on first paint — only react to real toggles
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (done) {
      Animated.sequence([
        Animated.spring(pop, { toValue: 1.25, ...motion.spring.bouncy, useNativeDriver: true }),
        Animated.spring(pop, { toValue: 1, ...motion.spring.snappy, useNativeDriver: true }),
      ]).start();
    }
  }, [done, fill, pop]);

  return (
    <Pressable
      onPress={onToggle}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={styles.checkboxHit}
    >
      <Animated.View style={[styles.checkbox, { transform: [{ scale: pop }] }]}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.checkboxFill,
            { opacity: fill, transform: [{ scale: fill }] },
          ]}
        />
        <Animated.Text style={[styles.checkmark, { opacity: fill, transform: [{ scale: fill }] }]}>
          ✓
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

/* ── Animated progress bar ───────────────────────────────────────────────── */

function ProgressBar({ progress }: { progress: number }) {
  const styles = useThemedStyles(createStyles);
  const width = useRef(new Animated.Value(progress)).current;

  useEffect(() => {
    Animated.timing(width, {
      toValue: progress,
      duration: motion.duration.slow,
      easing: motion.easing.out,
      useNativeDriver: false,
    }).start();
  }, [progress, width]);

  return (
    <View style={styles.progressTrack}>
      <Animated.View
        style={[
          styles.progressFill,
          {
            width: width.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
    </View>
  );
}

/* ── Empty state mark ─────────────────────────────────────────────────────
   A drawn geometric glyph rather than an emoji — colour emoji would be the
   only hue on the entire screen. */

function EmptyMark() {
  const styles = useThemedStyles(createStyles);
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2400,
          easing: motion.easing.inOut,
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2400,
          easing: motion.easing.inOut,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [float]);

  return (
    <Animated.View
      style={[
        styles.emptyMark,
        {
          transform: [
            { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) },
          ],
        },
      ]}
    >
      <View style={styles.emptyMarkLine} />
      <View style={[styles.emptyMarkLine, styles.emptyMarkLineMid]} />
      <View style={[styles.emptyMarkLine, styles.emptyMarkLineShort]} />
    </Animated.View>
  );
}

export default function TodoScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [editingTodo, setEditingTodo] = useState<TodoItem | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  // Bumped when the filter changes so the list remounts and re-staggers.
  // Deliberately not tied to the search box — restaggering on every keystroke
  // would be noise, not polish.
  const [listGeneration, setListGeneration] = useState(0);

  const searchFocusAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(searchFocusAnim, {
      toValue: searchFocused ? 1 : 0,
      duration: motion.duration.fast,
      easing: motion.easing.out,
      useNativeDriver: true,
    }).start();
  }, [searchFocused, searchFocusAnim]);

  // Secret hold states (20s total, progress ring starts at 12s)
  const [isHoldingProgress, setIsHoldingProgress] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fabScale = useRef(new Animated.Value(1)).current;
  const fabRotate = useRef(new Animated.Value(0)).current;

  const pressStartTimeRef = useRef<number>(0);
  const showProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerChatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Timestamps of recent title taps — the quick secret entry point.
  const titleTapsRef = useRef<number[]>([]);

  const handleTitleTap = useCallback(() => {
    const now = Date.now();

    // Keep only the taps still inside the window. Ageing them out is what
    // makes the count reset on its own after a pause — no timer needed, and
    // nothing to clean up on unmount.
    const recent = titleTapsRef.current.filter((t) => now - t < TITLE_TAP_WINDOW_MS);
    recent.push(now);
    titleTapsRef.current = recent;

    if (recent.length >= TITLE_TAP_COUNT) {
      titleTapsRef.current = [];
      navigation.navigate('Chat');
    }
  }, [navigation]);

  const resetHoldState = useCallback(() => {
    if (showProgressTimerRef.current) clearTimeout(showProgressTimerRef.current);
    if (triggerChatTimerRef.current) clearTimeout(triggerChatTimerRef.current);
    showProgressTimerRef.current = null;
    triggerChatTimerRef.current = null;

    progressAnim.stopAnimation();
    progressAnim.setValue(0);
    setIsHoldingProgress(false);
    setProgressPercent(0);
  }, [progressAnim]);

  const handleFabPressIn = () => {
    pressStartTimeRef.current = Date.now();

    Animated.parallel([
      Animated.spring(fabScale, { toValue: 0.9, ...motion.spring.snappy, useNativeDriver: true }),
      Animated.spring(fabRotate, { toValue: 1, ...motion.spring.gentle, useNativeDriver: true }),
    ]).start();

    // After 12s, show progress ring around FAB
    showProgressTimerRef.current = setTimeout(() => {
      setIsHoldingProgress(true);
      progressAnim.setValue(0);

      const listenerId = progressAnim.addListener(({ value }) => {
        setProgressPercent(Math.round(value * 100));
      });

      Animated.timing(progressAnim, {
        toValue: 1,
        duration: PROGRESS_DURATION_MS,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) {
          progressAnim.removeListener(listenerId);
        }
      });
    }, PROGRESS_START_MS);

    // After 20s (12s + 8s), unlock secret chat
    triggerChatTimerRef.current = setTimeout(() => {
      resetHoldState();
      navigation.navigate('Chat');
    }, SECRET_HOLD_MS);
  };

  const handleFabPressOut = () => {
    const heldMs = Date.now() - pressStartTimeRef.current;
    resetHoldState();

    Animated.parallel([
      Animated.spring(fabScale, { toValue: 1, ...motion.spring.bouncy, useNativeDriver: true }),
      Animated.spring(fabRotate, { toValue: 0, ...motion.spring.gentle, useNativeDriver: true }),
    ]).start();

    // Normal tap (<500ms): open task composer
    if (heldMs < 500) {
      setEditingTodo(null);
      setShowModal(true);
    }
  };

  const load = useCallback(async () => {
    const items = await getTodos();
    setTodos(items);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // ---- Filtered & grouped data ----

  const filteredTodos = useMemo(() => {
    let result = todos;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.category?.toLowerCase().includes(q) ||
          t.notes?.toLowerCase().includes(q)
      );
    }

    if (activeFilter !== 'All') {
      result = result.filter((t) => t.category === activeFilter);
    }

    return result;
  }, [todos, searchQuery, activeFilter]);

  const { overdue, today, upcoming, noDue, completed } = useMemo(() => {
    const now = new Date();
    const todayStr = now.toDateString();
    const groups = {
      overdue: [] as TodoItem[],
      today: [] as TodoItem[],
      upcoming: [] as TodoItem[],
      noDue: [] as TodoItem[],
      completed: [] as TodoItem[],
    };

    for (const t of filteredTodos) {
      if (t.done) {
        groups.completed.push(t);
        continue;
      }

      if (!t.due_date) {
        groups.noDue.push(t);
        continue;
      }

      const due = new Date(t.due_date);
      if (due.toDateString() === todayStr) {
        groups.today.push(t);
      } else if (due < now) {
        groups.overdue.push(t);
      } else {
        groups.upcoming.push(t);
      }
    }

    return groups;
  }, [filteredTodos]);

  // Build sections for the list
  const sections = useMemo(() => {
    const data: { type: 'header' | 'item'; title?: string; tone?: string; item?: TodoItem }[] = [];

    if (overdue.length > 0) {
      data.push({ type: 'header', title: `Overdue · ${overdue.length}`, tone: theme.severity.critical });
      overdue.forEach((item) => data.push({ type: 'item', item }));
    }
    if (today.length > 0) {
      data.push({ type: 'header', title: `Today · ${today.length}`, tone: theme.severity.high });
      today.forEach((item) => data.push({ type: 'item', item }));
    }
    if (upcoming.length > 0) {
      data.push({ type: 'header', title: `Upcoming · ${upcoming.length}`, tone: theme.severity.normal });
      upcoming.forEach((item) => data.push({ type: 'item', item }));
    }
    if (noDue.length > 0) {
      data.push({ type: 'header', title: `No Due Date · ${noDue.length}`, tone: theme.severity.muted });
      noDue.forEach((item) => data.push({ type: 'item', item }));
    }
    if (completed.length > 0) {
      data.push({ type: 'header', title: `Completed · ${completed.length}`, tone: theme.severity.muted });
      completed.forEach((item) => data.push({ type: 'item', item }));
    }

    return data;
  }, [overdue, today, upcoming, noDue, completed, theme]);

  // ---- Stats ----

  const totalCount = filteredTodos.length;
  const doneCount = completed.length;
  const progress = totalCount > 0 ? doneCount / totalCount : 0;

  // ---- Handlers ----

  const animateLayout = () =>
    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        motion.duration.normal,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity
      )
    );

  const handleToggle = async (item: TodoItem) => {
    animateLayout();
    await setTodoDone(item.id, !item.done);
    load();
  };

  const handleDelete = (item: TodoItem) => {
    Alert.alert('Delete Task', `Delete "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          animateLayout();
          await removeTodo(item.id);
          setTodos((cur) => cur.filter((t) => t.id !== item.id));
        },
      },
    ]);
  };

  const handleEdit = (item: TodoItem) => {
    setEditingTodo(item);
    setShowModal(true);
  };

  const handleSave = async (data: {
    title: string;
    priority: TodoPriority;
    due_date?: string;
    category?: string;
    notes?: string;
  }) => {
    animateLayout();

    if (editingTodo) {
      await updateTodo(editingTodo.id, data);
    } else {
      await insertTodo(data.title, data.priority, data.due_date, data.category, data.notes);
    }

    setShowModal(false);
    setEditingTodo(null);
    load();
  };

  const handleFilterChange = (filter: string) => {
    if (filter === activeFilter) return;
    setActiveFilter(filter);
    setListGeneration((g) => g + 1);
  };

  // ---- Due date label ----

  const dueDateLabel = (dueDate?: string) => {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    const now = new Date();
    const todayStr = now.toDateString();
    const tomorrow = new Date();
    tomorrow.setDate(now.getDate() + 1);

    if (due.toDateString() === todayStr) return 'Today';
    if (due.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    if (due < now) {
      const daysAgo = Math.ceil((now.getTime() - due.getTime()) / 86400000);
      return `${daysAgo}d overdue`;
    }
    return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const isDueOverdue = (dueDate?: string) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date() && new Date(dueDate).toDateString() !== new Date().toDateString();
  };

  // ---- Render ----

  const renderItem = ({ item: entry, index }: { item: typeof sections[number]; index: number }) => {
    if (entry.type === 'header') {
      return (
        <FadeSlideIn index={index} offsetY={10}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionDot, { backgroundColor: entry.tone }]} />
            <Text style={styles.sectionTitle}>{entry.title}</Text>
            <View style={styles.sectionRule} />
          </View>
        </FadeSlideIn>
      );
    }

    const item = entry.item!;
    const tone = priorityTone(theme, item.priority);
    const dueLabel = dueDateLabel(item.due_date);
    const isOverdue = !item.done && isDueOverdue(item.due_date);

    return (
      <FadeSlideIn index={index} offsetY={14}>
        <PressableScale
          style={[styles.row, isOverdue && styles.rowOverdue, item.done && styles.rowDone]}
          activeScale={0.985}
          onPress={() => handleToggle(item)}
          onLongPress={() => handleEdit(item)}
          delayLongPress={400}
        >
          {/* Priority accent bar — contrast is the signal */}
          <View style={[styles.priorityBar, { backgroundColor: tone }]} />

          <Checkbox done={item.done} onToggle={() => handleToggle(item)} />

          <View style={styles.rowContent}>
            <Text style={[styles.rowText, item.done && styles.rowTextDone]} numberOfLines={2}>
              {item.title}
            </Text>

            <View style={styles.metaRow}>
              <Text style={[styles.metaPriority, { color: tone }]}>
                {PRIORITY_LABEL[item.priority]}
              </Text>

              {item.category ? (
                <>
                  <View style={styles.metaSeparator} />
                  <Text style={styles.metaText}>{item.category}</Text>
                </>
              ) : null}

              {dueLabel ? (
                <>
                  <View style={styles.metaSeparator} />
                  <Text style={[styles.metaText, isOverdue && styles.metaTextOverdue]}>
                    {dueLabel}
                  </Text>
                </>
              ) : null}

              {item.notes ? (
                <>
                  <View style={styles.metaSeparator} />
                  <Text style={styles.metaText}>Note</Text>
                </>
              ) : null}
            </View>
          </View>

          <PressableScale
            style={styles.deleteButton}
            activeScale={0.85}
            onPress={() => handleDelete(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <CloseIcon color={theme.ink.mid} size={10} />
          </PressableScale>
        </PressableScale>
      </FadeSlideIn>
    );
  };

  const openCount = totalCount - doneCount;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar
        barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.surfaces.canvas}
      />

      {/* Header */}
      <View style={styles.header}>
        <FadeSlideIn index={0} offsetY={12}>
          <View style={styles.headerTop}>
            <View style={styles.headerTitleBlock}>
              {/* Plain Pressable, never PressableScale — no press animation,
                  no ripple, nothing that hints this is interactive. */}
              <Pressable onPress={handleTitleTap} style={styles.titleTapTarget}>
                <Text style={styles.title}>Tasks</Text>
              </Pressable>
              <AnimatedSwap swapKey={openCount}>
                <Text style={styles.subtitle}>
                  {openCount === 0 && totalCount > 0
                    ? 'All clear'
                    : openCount === 0
                    ? 'Nothing scheduled'
                    : `${openCount} remaining`}
                </Text>
              </AnimatedSwap>
            </View>

            {totalCount > 0 && (
              <View style={styles.statBlock}>
                <AnimatedSwap swapKey={`${doneCount}/${totalCount}`}>
                  <Text style={styles.statValue}>
                    {doneCount}
                    <Text style={styles.statTotal}>/{totalCount}</Text>
                  </Text>
                </AnimatedSwap>
                <Text style={styles.statLabel}>done</Text>
              </View>
            )}
          </View>
        </FadeSlideIn>

        {totalCount > 0 && (
          <FadeSlideIn index={1} offsetY={8}>
            <ProgressBar progress={progress} />
          </FadeSlideIn>
        )}

        {/* Search */}
        <FadeSlideIn index={2} offsetY={10}>
          <View style={styles.searchBar}>
            <Animated.View
              pointerEvents="none"
              style={[styles.searchFocusRing, { opacity: searchFocusAnim }]}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search tasks"
              placeholderTextColor={theme.ink.faint}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <PressableScale
                onPress={() => setSearchQuery('')}
                activeScale={0.8}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <CloseIcon color={theme.ink.low} size={11} />
              </PressableScale>
            )}
          </View>
        </FadeSlideIn>

        {/* Filter Chips */}
        <FadeSlideIn index={3} offsetY={10}>
          <FlatList
            horizontal
            data={FILTER_OPTIONS}
            keyExtractor={(item) => item}
            showsHorizontalScrollIndicator={false}
            style={styles.filterList}
            contentContainerStyle={styles.filterContent}
            renderItem={({ item: filter }) => {
              const active = activeFilter === filter;
              return (
                <PressableScale
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  activeScale={0.93}
                  onPress={() => handleFilterChange(filter)}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>
                    {filter}
                  </Text>
                </PressableScale>
              );
            }}
          />
        </FadeSlideIn>
      </View>

      {/* Task List */}
      {loading ? (
        <View style={styles.loaderWrap}>
          {[0, 1, 2, 3].map((i) => (
            <FadeSlideIn key={i} index={i} offsetY={10}>
              <View style={styles.skeletonRow}>
                <Shimmer width={20} height={20} radius={radius.pill} />
                <View style={styles.skeletonLines}>
                  <Shimmer width="72%" height={12} />
                  <Shimmer width="38%" height={8} style={styles.skeletonLineGap} />
                </View>
              </View>
            </FadeSlideIn>
          ))}
        </View>
      ) : (
        <FlatList
          key={`list-${listGeneration}`}
          data={sections}
          keyExtractor={(entry, i) =>
            entry.type === 'header' ? `header-${entry.title}-${i}` : entry.item!.id
          }
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: 160 + (insets.bottom || 24) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <FadeSlideIn index={1} offsetY={16}>
              <View style={styles.empty}>
                <EmptyMark />
                <Text style={styles.emptyText}>
                  {searchQuery || activeFilter !== 'All'
                    ? 'No matching tasks'
                    : 'Nothing here yet'}
                </Text>
                <Text style={styles.emptyHint}>
                  {searchQuery || activeFilter !== 'All'
                    ? 'Try a different filter or search'
                    : 'Tap + to add your first task'}
                </Text>
              </View>
            </FadeSlideIn>
          }
        />
      )}

      {/* FAB container with secret 20s hold progress ring (appears at 12s) */}
      <View
        style={[
          styles.fabContainer,
          {
            bottom: Platform.OS === 'android' ? Math.max(insets.bottom, 20) + 40 : insets.bottom + 32,
          },
        ]}
      >
        {isHoldingProgress && (
          <View style={styles.progressRingWrapper} pointerEvents="none">
            <Animated.View
              style={[
                styles.progressRingGlow,
                {
                  transform: [
                    {
                      scale: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 1.25],
                      }),
                    },
                  ],
                  opacity: progressAnim.interpolate({
                    inputRange: [0, 0.2, 1],
                    outputRange: [0.2, 0.5, 0.9],
                  }),
                },
              ]}
            />
            <Animated.View
              style={[
                styles.progressRingFill,
                {
                  borderWidth: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 4],
                  }),
                  opacity: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.4, 1],
                  }),
                },
              ]}
            />
            <View style={styles.progressBadge}>
              <Text style={styles.progressBadgeText}>{progressPercent}%</Text>
            </View>
          </View>
        )}

        <Pressable onPressIn={handleFabPressIn} onPressOut={handleFabPressOut}>
          <Animated.View
            style={[
              styles.fab,
              {
                transform: [
                  { scale: fabScale },
                  {
                    rotate: fabRotate.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '90deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={styles.fabText}>+</Text>
          </Animated.View>
        </Pressable>
      </View>

      {/* Edit / Create Modal */}
      <EditTodoModal
        visible={showModal}
        todo={editingTodo}
        onSave={handleSave}
        onClose={() => {
          setShowModal(false);
          setEditingTodo(null);
        }}
      />
    </SafeAreaView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.surfaces.canvas,
    },
    header: {
      paddingTop: space.sm,
    },
    headerTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      paddingHorizontal: space.lg,
      marginBottom: space.base,
    },
    headerTitleBlock: {
      flex: 1,
    },
    // Sized to the word itself so taps anywhere else in the header don't count
    titleTapTarget: {
      alignSelf: 'flex-start',
    },
    title: {
      ...type.display,
      color: t.ink.max,
    },
    subtitle: {
      ...type.callout,
      color: t.ink.low,
      marginTop: space.xxs,
    },
    statBlock: {
      alignItems: 'flex-end',
    },
    statValue: {
      fontSize: 20,
      fontWeight: '700',
      color: t.ink.max,
      fontVariant: ['tabular-nums'],
      letterSpacing: -0.4,
    },
    statTotal: {
      fontSize: 14,
      fontWeight: '500',
      color: t.ink.faint,
    },
    statLabel: {
      ...type.overline,
      fontSize: 9,
      color: t.ink.low,
      marginTop: space.xxs,
    },
    progressTrack: {
      height: 2,
      backgroundColor: t.surfaces.washStrong,
      marginHorizontal: space.lg,
      marginBottom: space.base,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: t.ink.max,
      borderRadius: radius.pill,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surfaces.sunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
      borderRadius: radius.md,
      marginHorizontal: space.base,
      paddingHorizontal: space.md,
      height: 42,
      marginBottom: space.md,
    },
    searchFocusRing: {
      ...(StyleSheet.absoluteFill as object),
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.borders.active,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: t.ink.max,
      padding: 0,
    },
    filterList: {
      maxHeight: 38,
      marginBottom: space.xs,
    },
    filterContent: {
      paddingHorizontal: space.base,
      gap: space.sm,
    },
    filterChip: {
      paddingHorizontal: space.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: t.surfaces.wash,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
    },
    filterChipActive: {
      backgroundColor: t.palette.accent,
      borderColor: t.palette.accent,
    },
    filterText: {
      fontSize: 12,
      fontWeight: '500',
      color: t.ink.mid,
    },
    filterTextActive: {
      color: t.palette.onAccent,
      fontWeight: '700',
    },
    loaderWrap: {
      paddingHorizontal: space.base,
      paddingTop: space.sm,
    },
    skeletonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surfaces.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
      padding: space.md,
      marginBottom: space.sm,
    },
    skeletonLines: {
      flex: 1,
      marginLeft: space.md,
    },
    skeletonLineGap: {
      marginTop: space.sm,
    },
    list: {
      paddingHorizontal: space.base,
      paddingTop: space.xs,
      flexGrow: 1,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: space.base,
      marginBottom: space.sm,
    },
    sectionDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      marginRight: space.sm,
    },
    sectionTitle: {
      ...type.overline,
      color: t.ink.low,
    },
    sectionRule: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.ink.ghost,
      marginLeft: space.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surfaces.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
      borderRadius: radius.lg,
      paddingVertical: space.md,
      paddingRight: space.md,
      marginBottom: space.sm,
      overflow: 'hidden',
      ...t.elevation.sm,
    },
    rowOverdue: {
      borderColor: t.borders.strong,
    },
    rowDone: {
      backgroundColor: t.surfaces.wash,
      borderColor: t.borders.subtle,
    },
    priorityBar: {
      width: 3,
      alignSelf: 'stretch',
      marginRight: space.md,
    },
    checkboxHit: {
      marginRight: space.md,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: t.borders.strong,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    checkboxFill: {
      borderRadius: 10,
      backgroundColor: t.palette.accent,
    },
    checkmark: {
      color: t.palette.onAccent,
      fontSize: 11,
      fontWeight: '900',
    },
    rowContent: {
      flex: 1,
    },
    rowText: {
      ...type.bodyStrong,
      fontWeight: '500',
      color: t.ink.max,
    },
    rowTextDone: {
      color: t.ink.faint,
      textDecorationLine: 'line-through',
      fontWeight: '400',
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginTop: space.xs + 1,
    },
    metaPriority: {
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.7,
    },
    metaSeparator: {
      width: 2,
      height: 2,
      borderRadius: 1,
      backgroundColor: t.ink.faint,
      marginHorizontal: space.sm,
    },
    metaText: {
      fontSize: 10.5,
      color: t.ink.low,
      fontWeight: '500',
    },
    metaTextOverdue: {
      color: t.ink.max,
      fontWeight: '700',
    },
    deleteButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: space.sm,
      backgroundColor: t.surfaces.wash,
    },
    empty: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 80,
    },
    emptyMark: {
      alignItems: 'center',
      marginBottom: space.lg,
      gap: space.sm,
    },
    emptyMarkLine: {
      width: 38,
      height: 3,
      borderRadius: 2,
      backgroundColor: t.ink.ghost,
    },
    emptyMarkLineMid: {
      width: 26,
    },
    emptyMarkLineShort: {
      width: 15,
    },
    emptyText: {
      ...type.heading,
      color: t.ink.mid,
    },
    emptyHint: {
      ...type.caption,
      color: t.ink.faint,
      marginTop: space.xs,
    },
    fabContainer: {
      position: 'absolute',
      right: space.lg,
      width: 76,
      height: 76,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fab: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.palette.accent,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.lg,
    },
    fabText: {
      color: t.palette.onAccent,
      fontSize: 28,
      lineHeight: 32,
      marginTop: -2,
      fontWeight: '300',
    },
    progressRingWrapper: {
      ...(StyleSheet.absoluteFill as object),
      alignItems: 'center',
      justifyContent: 'center',
    },
    progressRingGlow: {
      position: 'absolute',
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: t.surfaces.washStrong,
    },
    progressRingFill: {
      position: 'absolute',
      width: 70,
      height: 70,
      borderRadius: 35,
      borderColor: t.palette.accent,
    },
    progressBadge: {
      position: 'absolute',
      top: -26,
      backgroundColor: t.palette.accent,
      paddingHorizontal: space.sm,
      paddingVertical: 3,
      borderRadius: radius.sm,
      ...t.elevation.md,
    },
    progressBadgeText: {
      color: t.palette.onAccent,
      fontSize: 10,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
  });
