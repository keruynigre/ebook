export interface Voice {
  id: string;
  name: string;
  note: string;
  lang: 'tr' | 'en';
}

// Same voices as the novelvoice Space.
export const VOICES: Voice[] = [
  { id: 'tr-TR-AhmetNeural', name: 'Ahmet', note: 'Erkek, doğal anlatıcı', lang: 'tr' },
  { id: 'tr-TR-EmelNeural', name: 'Emel', note: 'Kadın, sıcak anlatıcı', lang: 'tr' },
  { id: 'en-US-ChristopherNeural', name: 'Christopher', note: 'Fantastik/aksiyon, dramatik', lang: 'en' },
  { id: 'en-US-GuyNeural', name: 'Guy', note: 'Klasik sesli kitap', lang: 'en' },
  { id: 'en-US-EricNeural', name: 'Eric', note: 'Enerjik, ifadeli', lang: 'en' },
  { id: 'en-US-JennyNeural', name: 'Jenny', note: 'Kadın, sıcak anlatıcı', lang: 'en' },
  { id: 'en-GB-RyanNeural', name: 'Ryan', note: 'İngiliz aksanı, fantastik', lang: 'en' },
  { id: 'en-US-AndrewMultilingualNeural', name: 'Andrew', note: 'Rahat, sohbet havası', lang: 'en' },
];

export const DEFAULT_VOICE = { tr: 'tr-TR-AhmetNeural', en: 'en-US-ChristopherNeural' } as const;

export const voiceName = (id: string) => VOICES.find((v) => v.id === id)?.name ?? id;
