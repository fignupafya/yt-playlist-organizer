# YouTube Playlist Organizer

Bulk-organize your YouTube playlists: multi-select videos and **add/remove them
across several playlists at once**. Ships as a **desktop Chrome extension** and an
**Android app**, sharing the same engine and UI.

> Scenario: `hd-downloads` is an auto-filled “inbox” playlist; `sport` and
> `gaming` are archives. Select the videos you’ve watched in `hd-downloads`,
> distribute them to the archives, and drop them from `hd-downloads` — all in one
> operation.

**Language:** English by default; switch to Turkish (or back) in Settings — the
choice is saved.
**Türkçe:** Varsayılan İngilizce; **Ayarlar**'dan Türkçe'ye (veya geri) geçebilir,
seçim kaydedilir. *(Türkçe açıklama aşağıda.)*

---

## How it works

The tool calls YouTube's **internal `youtubei` API** using your already–signed-in
session — exactly the requests your browser makes when you tick a box in the
“Save to playlist” dialog.

- ❌ No official Data API, OAuth, or Google Cloud setup.
- ❌ No quota limits.
- ✅ Watch-progress bars are preserved (the official API can't provide them).

## Features

- Lists **all** your playlists live (no URL pasting).
- Open a playlist → multi-select videos → bulk add/remove across playlists.
- **Two modes:**
  - **Override** — checked playlists get the video, unchecked ones have it
    removed; every selected video's membership is synced exactly to the boxes.
  - **Include / Exclude** — per playlist: **+ Add / · Leave / − Remove**.
    “Leave” playlists are never touched.
- **⚡ Direct Apply (background)** — skip preview/wait: fire the operation straight
  to the background. A progress bar appears at the top so you can keep selecting;
  tap it to reopen the live details. Start several operations at once — the bars
  stack vertically, and all writes stay safely rate-limited.
- Watch-progress bars, archive-membership chips, filter / sort / search.
- No item cap (all videos are read via continuation tokens).
- **Safety:** dry-run default · mandatory preview · never creates duplicates
  (idempotent) · aborts if a playlist can't be read · stops on first error ·
  429 auto-backoff · undo last batch.

---

## Install

### Chrome extension (desktop)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `youtube-playlist-organizer-extension` folder.
3. Click the toolbar icon → the app page opens. Make sure you're signed in to YouTube.

### Android app

Building an APK requires a build step (unavoidable for Android apps):

- **GitHub Actions (no local SDK):** push the `youtube-playlist-organizer-app`
  folder to a repo; the included `.github/workflows/build.yml` builds the APK —
  download it from the run's **Artifacts**.
- **Android Studio:** open the `youtube-playlist-organizer-app` folder →
  Build → Build APK(s).

Then sideload the APK (allow unknown sources; Play Protect may warn for any
sideloaded app — choose “Install anyway”). On first launch, sign in to YouTube once.

---

## Usage

1. Open the tool → your playlists appear.
2. Open a playlist → select videos.
3. **Operate** → choose a mode → set each target playlist → **Preview** → apply,
   or **⚡ Apply Directly** to run it in the background while you keep working.
4. **Dry-run is on by default** — it shows exactly what will happen and writes
   nothing. Try it on a test playlist first.

---

## Notes & limits

- The internal API is undocumented; if YouTube changes it, the tool may need an
  update (it fails visibly rather than corrupting anything).
- Personal-use project. Runs on your own account, on your own playlists.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE.md) — free for **noncommercial** use.

---
---

# YouTube Oynatma Listesi Düzenleyici (Türkçe)

YouTube oynatma listelerini topluca düzenle: videoları **çoklu seç** ve **aynı anda
birden çok listeye ekle/çıkar**. Hem **masaüstü Chrome eklentisi** hem **Android
uygulaması** olarak gelir; aynı motoru ve arayüzü paylaşırlar.

> Senaryo: `hd-downloads` otomatik dolan bir “gelen kutusu”; `sport` ve `gaming`
> arşivler. `hd-downloads`'ta izlediğin videoları seçip arşivlere dağıt, aynı anda
> `hd-downloads`'tan düşür — tek işlemde.

**Dil:** Varsayılan İngilizce; **Ayarlar**'dan Türkçe'ye (veya geri) geçebilirsin,
seçim kaydedilir.

## Nasıl çalışır

Araç, YouTube'un **iç `youtubei` API'sini** senin açık oturumunla çağırır —
“Listeye kaydet” penceresinde bir kutuyu işaretlediğinde tarayıcının attığı
isteklerin aynısı.

- ❌ Resmi Data API / OAuth / Google Cloud kurulumu **yok**.
- ❌ Kota limiti **yok**.
- ✅ İzlenme çubukları korunur (resmi API bunu veremez).

## Özellikler

- **Tüm** oynatma listelerini canlı gösterir (URL yapıştırmak yok).
- Listeye gir → videoları çoklu seç → listeler arası toplu ekle/çıkar.
- **İki mod:**
  - **Override (tam senkron)** — işaretli listeler videoyu alır, işaretsizlerden
    çıkarılır; seçili her videonun üyeliği kutulara birebir eşitlenir.
  - **Include / Exclude (kısmi)** — her liste için: **+ Ekle / · Dokunma /
    − Çıkar**. “Dokunma” listelere hiç dokunulmaz.
- **⚡ Direkt Uygula (arka plan)** — önizleme/bekleme yok; işlem doğrudan arka
  planda yürür. Üstte ilerleme çubuğu çıkar, sen seçime devam edebilirsin; çubuğa
  dokununca canlı detay tekrar açılır. Aynı anda birden çok işlem başlatabilirsin —
  çubuklar alt alta dizilir, tüm yazmalar güvenli hızda sıraya alınır.
- İzlenme çubukları, arşiv-üyelik rozetleri, filtre / sıralama / arama.
- Limit yok (tüm videolar devam-jetonuyla okunur).
- **Güvenlik:** varsayılan dry-run · zorunlu önizleme · kopya oluşturmaz
  (idempotent) · liste okunamazsa iptal · ilk hatada durur · 429'da otomatik
  bekleme · son partiyi geri al.

## Kurulum

### Chrome eklentisi (masaüstü)
1. `chrome://extensions` aç, **Geliştirici modu**'nu aç.
2. **Paketlenmemiş öğe yükle** → `youtube-playlist-organizer-extension` klasörünü seç.
3. Araç çubuğu simgesine tıkla → uygulama açılır. YouTube'da giriş yapmış ol.

### Android uygulaması
APK üretmek bir derleme adımı gerektirir:
- **GitHub Actions (kurulum gerektirmez):** `youtube-playlist-organizer-app`
  klasörünü bir repoya yükle; dahili `.github/workflows/build.yml` APK'yı üretir —
  çalışmanın **Artifacts** bölümünden indir.
- **Android Studio:** `youtube-playlist-organizer-app` klasörünü aç →
  Build → Build APK(s).

Sonra APK'yı kur (bilinmeyen kaynaklara izin ver; Play Protect uyarırsa “Yine de
yükle”). İlk açılışta bir kez YouTube'a giriş yap.

## Kullanım
1. Aracı aç → listelerin gelir.
2. Listeye gir → videoları seç.
3. **İşlem Yap** → mod seç → her hedef listeyi ayarla → **Önizle** → uygula, ya da
   **⚡ Direkt Uygula** ile çalışmaya devam ederken arka planda çalıştır.
4. **Dry-run varsayılan açık** — ne olacağını gösterir, hiçbir şey yazmaz. Önce bir
   test listesinde dene.

## Notlar
- İç API belgesizdir; YouTube değiştirirse araç güncelleme gerektirebilir (hiçbir
  şeyi bozmaz, görünür şekilde başarısız olur).
- Kişisel kullanım içindir. Kendi hesabında, kendi listelerinde çalışır.

## Lisans
[PolyForm Noncommercial License 1.0.0](LICENSE.md) — **ticari olmayan** kullanım için serbest.
