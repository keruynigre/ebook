# Ebook

Web roman sitelerinde okuduğunuz romanları telefonunuza indirip **EPUB** dosyasına çeviren Android uygulaması.

Plan:

1. **İlk sürüm (bu sürüm):** bağlantı → bölüm listesi → bölüm indirme → EPUB oluşturma, paylaşma ve kaydetme
2. **Okuyucu ve hikâye defteri:** uygulama içi okuma, karakter listesi, özetler, sözlük
3. **Görseller:** bölüm başına yaklaşık 15 kare, çizgi roman tarzı ve tutarlı karakterler

## Kurulum (telefondan)

1. GitHub'da bu reponun **Releases** sayfasını açın.
2. En üstteki sürümdeki `ebook-….apk` dosyasını indirin ve açın.
3. Android, tarayıcıya "bilinmeyen uygulamaları yükleme" izni vermenizi ister. İzin verip kurun.

Yeni sürümler eskisinin üstüne kurulur; kitaplığınız silinmez.

## Kullanım

1. Romanın ana sayfasını (bölüm listesinin olduğu sayfayı) tarayıcıda açın ve adresini kopyalayın.
2. Uygulamada **+ Ekle** → **Yapıştır** → **Bul** → **Kitaplığa ekle**.
3. Bölüm aralığını seçin (ör. 1–50) → **İndir**.
4. **Okumaya başla** ile kitabı uygulama içinde okuyun. Kaldığınız yer, yazı boyutu ve tema (Aa) hatırlanır.
5. İsterseniz **EPUB oluştur** → **Paylaş** (okuma uygulamanızı seçin), **Aç** ya da **Klasöre kaydet**.

İndirme sürerken bildirim çubuğunda ilerleme görünür; uygulamayı aşağı indirseniz ya da ekranı kapatsanız da indirme devam eder. İndirilen bölümler telefonda saklanır. İndirme yarıda kalırsa tekrar **İndir**'e basın; zaten indirilmiş bölümler atlanır.

### Türkçe çeviri (Gemini)

1. https://aistudio.google.com/apikey adresinden ücretsiz bir Gemini API anahtarı alın.
2. Uygulamada **Ayarlar** → anahtarı yapıştırın → **Kaydet** → bir model seçin ("Flash" önerilir).
3. Kitap sayfasında aralık seçip **Türkçeye çevir**'e basın ya da Ayarlar'dan **İndirirken otomatik çevir**'i açın.

Karakter adları çevrilmez. Unvanlar ve teknik adlar gibi terimler için her kitaba bir sözlük tutulur; böylece aynı terim kitap boyunca aynı karşılıkla çevrilir. Okurken **Aa** → **Dil** ile Türkçe ve orijinal arasında geçebilirsiniz. EPUB oluştururken dil sorulur.

Ücretsiz katmanın günlük bir sınırı vardır. Sınır dolunca çeviri durur, indirme devam eder; ertesi gün **Türkçeye çevir** ile kalınan yerden sürdürülür. Anahtar telefonda şifreli saklanır ve yalnızca Google'a gönderilir.

### Desteklenen siteler

- **NovelFull** ve aynı temayı kullanan siteler: tam destek
- Diğer siteler: deneysel genel okuyucu

Site bir güvenlik kontrolü ("Just a moment…") gösterirse uygulama kontrolü gizli bir tarayıcıda geçmeye çalışır. Gerekirse sayfayı size gösterir; kutucuğa dokunduğunuzda indirme kendiliğinden devam eder.

Uygulama yalnızca kişisel okuma içindir. Oluşturulan EPUB dosyalarını paylaşmayın. Bölümler siteyi yormamak için birkaç saniye arayla indirilir.

## Geliştirme

Expo (SDK 58) + React Native + TypeScript.

```bash
npm install
npm run typecheck
npm test              # ayrıştırıcı ve EPUB testleri
npx expo start        # geliştirme sunucusu
```

- `src/app/`: ekranlar (Expo Router); `read/[id]/[index].tsx` uygulama içi okuyucu
- `src/lib/sources/`: site ayrıştırıcıları (`novelfull.ts`, `generic.ts`)
- `src/lib/epub.ts`: EPUB 3 oluşturucu
- `src/lib/downloads.ts`: bölüm indirme ve çeviri kuyruğu
- `src/lib/gemini.ts`: Gemini ile çeviri ve terim sözlüğü
- `src/components/BrowserHost.tsx`: site doğrulamalarını geçen gizli WebView
- `modules/ebook-foreground/`: indirmeyi arka planda sürdüren Android ön plan hizmeti (Kotlin)

`main` dalına yapılan her gönderimde GitHub Actions APK'yı derler ve **Releases** sayfasında yayınlar (`.github/workflows/android.yml`).

APK, Expo şablonundaki sabit hata ayıklama anahtarıyla imzalanır. Böylece her sürüm öncekinin üstüne kurulabilir. Bu anahtar herkese açıktır; uygulama mağazaya konacaksa kendi anahtarınıza geçilmelidir.
