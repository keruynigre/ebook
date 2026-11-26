import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

/** One picture drawn for a moment of the chapter, shown between the paragraphs of the text. */
export function InlinePicture({
  uri,
  width,
  version,
  waiting,
  border,
  onLongPress,
}: {
  /** File of the drawn picture; null while it is not drawn yet. */
  uri: string | null;
  width: number;
  version: number;
  /** Drawing is under way: show a quiet placeholder instead of nothing. */
  waiting: boolean;
  border: string;
  onLongPress: () => void;
}) {
  const [ratio, setRatio] = useState(0.75);
  if (!uri && !waiting) return null;
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={450} style={{ marginTop: 4, marginBottom: 18 }}>
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width, height: width * ratio, borderRadius: 10, borderWidth: 1, borderColor: border }}
          onLoad={(e) => {
            const r = e.source.height / Math.max(1, e.source.width);
            if (r > 0 && Math.abs(r - ratio) > 0.01) setRatio(r);
          }}
          contentFit="contain"
          cachePolicy="none"
          recyclingKey={`${uri}-${version}`}
          transition={250}
        />
      ) : (
        <View
          style={{ width, height: width * 0.75, borderRadius: 10, borderWidth: 1, borderColor: border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}
        >
          <ActivityIndicator color={border} />
        </View>
      )}
    </Pressable>
  );
}
