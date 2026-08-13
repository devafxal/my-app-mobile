import React, { useState, useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  View,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Pressable,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { TodoItem, TodoPriority } from '../db';
import { FadeSlideIn, PressableScale } from './ui/motion';
import { CloseIcon } from './ui/icons';
import {
  motion,
  radius,
  space,
  Theme,
  type,
  useTheme,
  useThemedStyles,
} from '../theme';

const SCREEN_HEIGHT = Dimensions.get('window').height;

const CATEGORIES = ['Work', 'Personal', 'Health', 'Shopping', 'Other'];

/** Priority is expressed as contrast — no hue anywhere in this sheet. */
const priorityConfig = (t: Theme): Record<TodoPriority, { label: string; tone: string }> => ({
  high: { label: 'High', tone: t.severity.critical },
  medium: { label: 'Medium', tone: t.severity.high },
  low: { label: 'Low', tone: t.severity.muted },
});

interface Props {
  visible: boolean;
  todo?: TodoItem | null;          // null = creating new
  onSave: (data: {
    title: string;
    priority: TodoPriority;
    due_date?: string;
    category?: string;
    notes?: string;
  }) => void;
  onClose: () => void;
}

export default function EditTodoModal({ visible, todo, onSave, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const priorities = priorityConfig(theme);

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TodoPriority>('low');
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [category, setCategory] = useState<string>('');
  const [notes, setNotes] = useState('');

  /** Kept mounted through the exit animation so the sheet can slide out. */
  const [rendered, setRendered] = useState(visible);
  const slide = useRef(new Animated.Value(0)).current;

  const isEditing = !!todo;

  useEffect(() => {
    if (visible) {
      setTitle(todo?.title || '');
      setPriority(todo?.priority || 'low');
      setDueDate(todo?.due_date ? new Date(todo.due_date) : null);
      setCategory(todo?.category || '');
      setNotes(todo?.notes || '');
      setShowDatePicker(false);
    }
  }, [visible, todo]);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.spring(slide, {
        toValue: 1,
        ...motion.spring.gentle,
        useNativeDriver: true,
      }).start();
    } else if (rendered) {
      Animated.timing(slide, {
        toValue: 0,
        duration: motion.duration.fast,
        easing: motion.easing.in,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [visible, slide, rendered]);

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      priority,
      due_date: dueDate ? dueDate.toISOString() : undefined,
      category: category || undefined,
      notes: notes.trim() || undefined,
    });
  };

  const handleDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) setDueDate(selectedDate);
  };

  const formatDate = (date: Date) => {
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';

    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <Modal
      visible={rendered}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <Animated.View style={[styles.backdrop, { opacity: slide }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom:
                Platform.OS === 'android'
                  ? Math.max(insets.bottom, 24) + 24
                  : insets.bottom + 32,
              transform: [
                {
                  translateY: slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [SCREEN_HEIGHT * 0.5, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.handle} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.sheetScroll}
          >
            <FadeSlideIn index={0} offsetY={8}>
              <Text style={styles.sheetTitle}>{isEditing ? 'Edit Task' : 'New Task'}</Text>
            </FadeSlideIn>

            {/* Title */}
            <FadeSlideIn index={1} offsetY={8}>
              <TextInput
                style={styles.titleInput}
                placeholder="What needs to be done?"
                placeholderTextColor={theme.ink.faint}
                value={title}
                onChangeText={setTitle}
                autoFocus={!isEditing}
                maxLength={200}
                multiline
              />
            </FadeSlideIn>

            {/* Priority */}
            <FadeSlideIn index={2} offsetY={8}>
              <Text style={styles.sectionLabel}>Priority</Text>
              <View style={styles.priorityRow}>
                {(['high', 'medium', 'low'] as TodoPriority[]).map((p) => {
                  const cfg = priorities[p];
                  const active = priority === p;
                  return (
                    <PressableScale
                      key={p}
                      style={[styles.priorityChip, active && styles.priorityChipActive]}
                      activeScale={0.94}
                      onPress={() => setPriority(p)}
                    >
                      <View style={[styles.priorityDot, { backgroundColor: cfg.tone }]} />
                      <Text style={[styles.priorityLabel, active && styles.priorityLabelActive]}>
                        {cfg.label}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            </FadeSlideIn>

            {/* Due Date */}
            <FadeSlideIn index={3} offsetY={8}>
              <Text style={styles.sectionLabel}>Due Date</Text>
              <View style={styles.dateRow}>
                <PressableScale
                  style={[styles.dateButton, dueDate && styles.dateButtonActive]}
                  activeScale={0.97}
                  onPress={() => setShowDatePicker(true)}
                >
                  <Text style={[styles.dateText, dueDate && styles.dateTextActive]}>
                    {dueDate ? formatDate(dueDate) : 'Set due date'}
                  </Text>
                </PressableScale>

                {dueDate && (
                  <PressableScale
                    style={styles.clearDateButton}
                    activeScale={0.85}
                    onPress={() => setDueDate(null)}
                  >
                    <CloseIcon color={theme.ink.mid} size={11} />
                  </PressableScale>
                )}
              </View>
            </FadeSlideIn>

            {showDatePicker && (
              <View style={styles.pickerContainer}>
                <DateTimePicker
                  value={dueDate || new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleDateChange}
                  minimumDate={new Date()}
                  themeVariant={theme.mode}
                />
                {Platform.OS === 'ios' && (
                  <PressableScale
                    style={styles.pickerDone}
                    activeScale={0.96}
                    onPress={() => setShowDatePicker(false)}
                  >
                    <Text style={styles.pickerDoneText}>Done</Text>
                  </PressableScale>
                )}
              </View>
            )}

            {/* Category */}
            <FadeSlideIn index={4} offsetY={8}>
              <Text style={styles.sectionLabel}>Category</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.categoryScroll}
                contentContainerStyle={styles.categoryContent}
              >
                {CATEGORIES.map((cat) => {
                  const active = category === cat;
                  return (
                    <PressableScale
                      key={cat}
                      style={[styles.categoryChip, active && styles.categoryChipActive]}
                      activeScale={0.93}
                      onPress={() => setCategory(active ? '' : cat)}
                    >
                      <Text style={[styles.categoryText, active && styles.categoryTextActive]}>
                        {cat}
                      </Text>
                    </PressableScale>
                  );
                })}
              </ScrollView>
            </FadeSlideIn>

            {/* Notes */}
            <FadeSlideIn index={5} offsetY={8}>
              <Text style={styles.sectionLabel}>Notes</Text>
              <TextInput
                style={styles.notesInput}
                placeholder="Add details"
                placeholderTextColor={theme.ink.faint}
                value={notes}
                onChangeText={setNotes}
                multiline
                maxLength={500}
                textAlignVertical="top"
              />
            </FadeSlideIn>

            {/* Actions */}
            <FadeSlideIn index={6} offsetY={8}>
              <View style={styles.actions}>
                <PressableScale style={styles.cancelButton} activeScale={0.96} onPress={onClose}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </PressableScale>
                <PressableScale
                  style={[styles.saveButton, !title.trim() && styles.saveButtonDisabled]}
                  activeScale={0.96}
                  onPress={handleSave}
                  disabled={!title.trim()}
                >
                  <Text style={[styles.saveText, !title.trim() && styles.saveTextDisabled]}>
                    {isEditing ? 'Update' : 'Add Task'}
                  </Text>
                </PressableScale>
              </View>
            </FadeSlideIn>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...(StyleSheet.absoluteFill as object),
      backgroundColor: t.surfaces.scrim,
    },
    sheet: {
      backgroundColor: t.surfaces.card,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.default,
      paddingHorizontal: space.lg,
      maxHeight: '88%',
      ...t.elevation.lg,
    },
    sheetScroll: {
      flexGrow: 1,
      paddingBottom: space.lg,
    },
    handle: {
      width: 34,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.ink.faint,
      alignSelf: 'center',
      marginTop: space.md,
      marginBottom: space.base,
    },
    sheetTitle: {
      ...type.title,
      color: t.ink.max,
      marginBottom: space.base,
    },
    titleInput: {
      backgroundColor: t.surfaces.sunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
      borderRadius: radius.md,
      color: t.ink.max,
      paddingHorizontal: space.base,
      paddingVertical: space.md,
      fontSize: 15,
      marginBottom: space.base,
      minHeight: 48,
    },
    sectionLabel: {
      ...type.overline,
      color: t.ink.low,
      marginBottom: space.sm,
    },
    priorityRow: {
      flexDirection: 'row',
      gap: space.sm,
      marginBottom: space.base,
    },
    priorityChip: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: space.md,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
      backgroundColor: t.surfaces.wash,
    },
    priorityChipActive: {
      borderColor: t.borders.active,
      backgroundColor: t.surfaces.washStrong,
    },
    priorityDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      marginRight: space.sm,
    },
    priorityLabel: {
      fontSize: 12.5,
      fontWeight: '600',
      color: t.ink.mid,
    },
    priorityLabelActive: {
      color: t.ink.max,
    },
    dateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: space.base,
      gap: space.sm,
    },
    dateButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surfaces.sunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
      borderRadius: radius.sm,
      paddingVertical: space.md,
      paddingHorizontal: space.base,
    },
    dateButtonActive: {
      borderColor: t.borders.strong,
      backgroundColor: t.surfaces.washStrong,
    },
    dateText: {
      fontSize: 13.5,
      color: t.ink.low,
    },
    dateTextActive: {
      color: t.ink.max,
      fontWeight: '600',
    },
    clearDateButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: t.surfaces.wash,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pickerContainer: {
      backgroundColor: t.surfaces.sunken,
      borderRadius: radius.sm,
      marginBottom: space.base,
      overflow: 'hidden',
    },
    pickerDone: {
      alignItems: 'center',
      paddingVertical: space.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.borders.subtle,
    },
    pickerDoneText: {
      color: t.ink.max,
      fontWeight: '600',
      fontSize: 14,
    },
    categoryScroll: {
      marginBottom: space.base,
    },
    categoryContent: {
      gap: space.sm,
      paddingRight: space.lg,
    },
    categoryChip: {
      paddingHorizontal: space.md,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: t.surfaces.wash,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
    },
    categoryChipActive: {
      backgroundColor: t.palette.accent,
      borderColor: t.palette.accent,
    },
    categoryText: {
      color: t.ink.mid,
      fontSize: 12.5,
      fontWeight: '500',
    },
    categoryTextActive: {
      color: t.palette.onAccent,
      fontWeight: '700',
    },
    notesInput: {
      backgroundColor: t.surfaces.sunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
      borderRadius: radius.md,
      color: t.ink.max,
      paddingHorizontal: space.base,
      paddingVertical: space.md,
      fontSize: 13.5,
      marginBottom: space.lg,
      minHeight: 80,
    },
    actions: {
      flexDirection: 'row',
      gap: space.md,
    },
    cancelButton: {
      flex: 1,
      paddingVertical: space.md + 2,
      borderRadius: radius.md,
      backgroundColor: t.surfaces.wash,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
      alignItems: 'center',
    },
    cancelText: {
      color: t.ink.mid,
      fontSize: 14,
      fontWeight: '600',
    },
    saveButton: {
      flex: 2,
      paddingVertical: space.md + 2,
      borderRadius: radius.md,
      backgroundColor: t.palette.accent,
      alignItems: 'center',
      ...t.elevation.md,
    },
    saveButtonDisabled: {
      backgroundColor: t.surfaces.washStrong,
      shadowOpacity: 0,
      elevation: 0,
    },
    saveText: {
      color: t.palette.onAccent,
      fontSize: 14,
      fontWeight: '700',
    },
    saveTextDisabled: {
      color: t.ink.faint,
    },
  });
