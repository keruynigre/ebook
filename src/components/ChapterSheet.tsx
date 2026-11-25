import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../lib/theme';
import type { Book, ChapterRef } from '../lib/types';
import { Button, ui } from './ui';

const ROW_H = 48;
const BLOCK = 100;

const Row = memo(function Row({
  index,
  chapter,
  downloaded,
  translated,
  selecting,
  selected,
  current,
  highlighted,
  onPress,
  onLongPress,
}: {
  index: number;
  chapter: ChapterRef;
  downloaded: boolean;
  translated: boolean;
  selecting: boolean;
  selected: boolean;
  current: boolean;
  highlighted: boolean;
  onPress: (i: number) => void;
  onLongPress?: (i: number) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(index)}
      onLongPress={onLongPress ? () => onLongPress(index) : undefined}
      delayLongPress={300}
      style={({ pressed }) => [
        styles.row,
        current && { backgroundColor: '#24324a' },
        highlighted && { backgroundColor: '#3a2f1a' },
        selected && { backgroundColor: '#2a2317' },
        pressed && { opacity: 0.7 },
      ]}
    >
      {selecting ? (
        <Text style={[styles.mark, { color: selected ? colors.accent : colors.muted, fontSize: 16 }]}>{selected ? '☑' : '☐'}</Text>
      ) : (
        <Text style={[styles.mark, { color: downloaded ? colors.success : colors.border }]}>{downloaded ? '●' : '○'}</Text>
      )}
      <Text style={styles.no}>{index + 1}</Text>
      <Text style={[ui.text, { flex: 1, color: downloaded ? colors.text : colors.muted }]} numberOfLines={1}>
        {chapter.title}
      </Text>
      {translated && <Text style={styles.tr}>TR</Text>}
    </Pressable>
  );
});

/**
 * Chapter list in a pop-up window, split into blocks of 100 so long novels
 * never need endless scrolling. Optional multi-select (long press).
 */
export function ChapterSheet({
  visible,
  book,
  current,
  onClose,
  onOpen,
  selected,
  onToggle,
  footer,
}: {
  visible: boolean;
  book: Book;
  /** Chapter to start at and mark (e.g. the one being read). */
  current?: number;
  onClose: () => void;
  /** Tap on a downloaded chapter (or any chapter when not selecting and no onToggle). */
  onOpen: (index: number) => void;
  selected?: Set<number>;
  onToggle?: (index: number) => void;
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const total = book.chapters.length;
  const blocks = Math.max(1, Math.ceil(total / BLOCK));
  const startBlock = Math.floor(Math.max(0, current ?? book.progress?.index ?? 0) / BLOCK);
  const [block, setBlock] = useState(startBlock);
  const [jump, setJump] = useState('');
  const [highlight, setHighlight] = useState<number | null>(null);
  const listRef = useRef<FlatList<ChapterRef>>(null);
  const tabsRef = useRef<ScrollViewInstance>(null);
  const downloaded = useMemo(() => new Set(book.downloaded), [book.downloaded]);
  const translated = useMemo(() => new Set(book.translated ?? []), [book.translated]);
  const selecting = !!selected && selected.size > 0;

  // Each time the window opens, start at the current chapter's block.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      setBlock(startBlock);
      const target = current ?? book.progress?.index;
      if (target !== undefined && Math.floor(target / BLOCK) === startBlock) {
        listRef.current?.scrollToOffset({ offset: Math.max(0, (target % BLOCK) - 3) * ROW_H, animated: false });
      }
      tabsRef.current?.scrollTo({ x: Math.max(0, startBlock * 92 - 100), animated: false });
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const from = block * BLOCK;
  const data = useMemo(() => book.chapters.slice(from, from + BLOCK), [book.chapters, from]);

  const goTo = () => {
    const n = parseInt(jump, 10);
    if (!Number.isFinite(n) || n < 1 || n > total) return;
    Keyboard.dismiss();
    const b = Math.floor((n - 1) / BLOCK);
    setBlock(b);
    setHighlight(n - 1);
    setJump('');
    setTimeout(() => listRef.current?.scrollToOffset({ offset: Math.max(0, ((n - 1) % BLOCK) - 3) * ROW_H, animated: true }), 80);
    tabsRef.current?.scrollTo({ x: Math.max(0, b * 92 - 100), animated: true });
  };

  const press = (i: number) => {
    if (selecting && onToggle) return onToggle(i);
    if (downloaded.has(i) || !onToggle) return onOpen(i);
    onToggle(i);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.sheet, { paddingTop: insets.top + 8, paddingBottom: insets.bottom }]}>
        <View style={styles.head}>
          <Text style={[ui.h2, { marginBottom: 0, flex: 1 }]} numberOfLines={1}>
            Bölümler · {total}
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: colors.text, fontSize: 22 }}>✕</Text>
          </Pressable>
        </View>
        <View style={[ui.row, { paddingHorizontal: 12 }]}>
          <TextInput
            value={jump}
            onChangeText={setJump}
            placeholder={`Bölüme git (1–${total})`}
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            returnKeyType="go"
            onSubmitEditing={goTo}
            style={[ui.input, { flex: 1 }]}
          />
          <Button title="Git" onPress={goTo} disabled={!jump.trim()} />
        </View>
        {blocks > 1 && (
          <ScrollView
            ref={tabsRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingVertical: 10 }}
          >
            {Array.from({ length: blocks }, (_, b) => {
              const active = b === block;
              return (
                <Pressable
                  key={b}
                  onPress={() => {
                    setBlock(b);
                    listRef.current?.scrollToOffset({ offset: 0, animated: false });
                  }}
                  style={[styles.tab, active && { backgroundColor: colors.accent, borderColor: colors.accent }]}
                >
                  <Text style={{ color: active ? colors.accentText : colors.text, fontWeight: '700', fontSize: 13 }}>
                    {b * BLOCK + 1}–{Math.min(total, (b + 1) * BLOCK)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <FlatList
          ref={listRef}
          data={data}
          keyExtractor={(c, k) => `${from + k}:${c.url}`}
          renderItem={({ item, index }) => (
            <Row
              index={from + index}
              chapter={item}
              downloaded={downloaded.has(from + index)}
              translated={translated.has(from + index)}
              selecting={selecting}
              selected={!!selected?.has(from + index)}
              current={current === from + index}
              highlighted={highlight === from + index}
              onPress={press}
              onLongPress={onToggle}
            />
          )}
          extraData={[selected, highlight, current]}
          getItemLayout={(_d, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
        />
        {footer}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, gap: 12 },
  tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: colors.border, minWidth: 86, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: ROW_H,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  mark: { fontSize: 12, width: 18, textAlign: 'center' },
  no: { color: colors.muted, fontSize: 12, minWidth: 34, textAlign: 'right' },
  tr: { color: colors.accent, fontSize: 11, fontWeight: '800', borderWidth: 1, borderColor: colors.accent, borderRadius: 4, paddingHorizontal: 4 },
});
