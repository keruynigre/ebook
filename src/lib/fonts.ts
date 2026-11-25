import { AtkinsonHyperlegible_400Regular } from '@expo-google-fonts/atkinson-hyperlegible/400Regular';
import { AtkinsonHyperlegible_700Bold } from '@expo-google-fonts/atkinson-hyperlegible/700Bold';
import { Lexend_400Regular } from '@expo-google-fonts/lexend/400Regular';
import { Lexend_700Bold } from '@expo-google-fonts/lexend/700Bold';
import { Literata_400Regular } from '@expo-google-fonts/literata/400Regular';
import { Literata_700Bold } from '@expo-google-fonts/literata/700Bold';
import { Lora_400Regular } from '@expo-google-fonts/lora/400Regular';
import { Lora_700Bold } from '@expo-google-fonts/lora/700Bold';
import { Merriweather_400Regular } from '@expo-google-fonts/merriweather/400Regular';
import { Merriweather_700Bold } from '@expo-google-fonts/merriweather/700Bold';
import { NotoSerif_400Regular } from '@expo-google-fonts/noto-serif/400Regular';
import { NotoSerif_700Bold } from '@expo-google-fonts/noto-serif/700Bold';

/** Reader fonts. All cover Turkish letters. Only regular and bold are bundled to keep the app small. */
export const READER_FONTS = {
  system: { label: 'Sistem', note: 'Telefonun varsayılanı', regular: undefined, bold: undefined },
  lexend: { label: 'Lexend', note: 'Akıcı okuma için tasarlandı', regular: 'Lexend_400Regular', bold: 'Lexend_700Bold' },
  literata: { label: 'Literata', note: 'Google Play Kitaplar yazı tipi', regular: 'Literata_400Regular', bold: 'Literata_700Bold' },
  merriweather: { label: 'Merriweather', note: 'Ekranda okunaklı tırnaklı', regular: 'Merriweather_400Regular', bold: 'Merriweather_700Bold' },
  lora: { label: 'Lora', note: 'Zarif, kitap havası', regular: 'Lora_400Regular', bold: 'Lora_700Bold' },
  notoSerif: { label: 'Noto Serif', note: 'Klasik tırnaklı', regular: 'NotoSerif_400Regular', bold: 'NotoSerif_700Bold' },
  atkinson: {
    label: 'Atkinson Hyperlegible',
    note: 'Harfler birbirinden çok net ayrılır',
    regular: 'AtkinsonHyperlegible_400Regular',
    bold: 'AtkinsonHyperlegible_700Bold',
  },
} as const;

export type ReaderFont = keyof typeof READER_FONTS;

/** Passed to expo-font's useFonts in the root layout. */
export const FONT_FILES = {
  Lexend_400Regular,
  Lexend_700Bold,
  Literata_400Regular,
  Literata_700Bold,
  Merriweather_400Regular,
  Merriweather_700Bold,
  Lora_400Regular,
  Lora_700Bold,
  NotoSerif_400Regular,
  NotoSerif_700Bold,
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
};
