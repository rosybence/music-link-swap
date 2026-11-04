// Music Link Swap matching script.
// The app downloads this file from GitHub every time it runs, so changes here
// go live on the next tap without reinstalling the app.
//
// Host functions provided by the app:
//   httpGet(url, headersJson) -> JSON string {status, body, url}
//   toast(message)
// Must define convert(text, source) returning a JSON string:
//   {action: 'whatsapp' | 'open' | 'error', url, pkg, toast}
// source is 'view' (a tapped link) or 'share' (Share menu).

var YTM_PKG = 'com.google.android.apps.youtube.music';
var SPOTIFY_PKG = 'com.spotify.music';
var DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
var YT_HEADERS = { 'User-Agent': DESKTOP_UA, 'Cookie': 'SOCS=CAI; CONSENT=YES+1' };

var why = '';

function get(url, headers) {
  var r = JSON.parse(httpGet(url, headers ? JSON.stringify(headers) : null));
  if (r.status === 200) return r;
  why = r.status ? 'HTTP ' + r.status : 'no connection';
  return null;
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function unescapeJson(s) {
  return s.replace(/\\u0026/g, '&').replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/\\"/g, '"');
}

function meta(html, prop) {
  var m = html.match(new RegExp('<meta[^>]+(?:property|name)="' + prop + '"[^>]+content="([^"]*)"', 'i'))
       || html.match(new RegExp('<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="' + prop + '"', 'i'));
  return m ? decodeEntities(m[1]) : '';
}

// Lowercase, drop brackets/feat/remaster noise and punctuation, for comparing titles.
function norm(s) {
  return (s || '').toLowerCase()
    .replace(/\(([^)]*)\)|\[([^\]]*)\]/g, ' ')
    .replace(/\s-\s.*(remaster|version|edit|mix|live|mono|stereo).*$/, ' ')
    .replace(/\b(feat|ft|featuring)\b.*$/, ' ')
    .replace(/[^a-z0-9À-ɏЀ-ӿ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function similar(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 0.8;
  var wa = a.split(' '), hits = 0;
  for (var i = 0; i < wa.length; i++) if ((' ' + b + ' ').indexOf(' ' + wa[i] + ' ') !== -1) hits++;
  return hits / Math.max(wa.length, b.split(' ').length) * 0.7;
}

function videoId(url) {
  var m = url.match(/[?&]v=([\w-]{11})/) || url.match(/youtu\.be\/([\w-]{11})/);
  return m ? m[1] : null;
}

// ---------- YouTube Music -> Spotify ----------

// Version words that mean "not the original recording".
var VARIANT = /\b(live|remix|acoustic|instrumental|karaoke|sped up|slowed|cover|demo|reverb)\b/i;

// Title for searching: drop "(Official Video)", "- 2004 Remaster", "feat." etc.
function searchTitle(t) {
  return (t || '')
    .replace(/\((official|lyric|lyrics|audio|visuali[sz]er|music video|video|hd|hq)[^)]*\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s-\s[^-]*(remaster|version|edit|mono|stereo)[^-]*$/i, '')
    .replace(/\((feat\.?|ft\.?|featuring|with)\s[^)]*\)/gi, '')
    .replace(/\s(feat\.?|ft\.?|featuring)\s.*$/i, '')
    .replace(/\s+/g, ' ').trim();
}

function ytSong(id) {
  var r = get('https://www.youtube.com/oembed?format=json&url=' +
              encodeURIComponent('https://www.youtube.com/watch?v=' + id));
  if (!r) return null;
  try {
    var j = JSON.parse(r.body);
    var author = j.author_name || '';
    var title = j.title || '';
    var artist = author.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '')
                       .replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    // Uploads that aren't official audio are usually titled "Artist - Song (Official Video)".
    var dash = title.indexOf(' - ');
    if (!/ - Topic$/i.test(author) && dash > 0) {
      artist = title.slice(0, dash).split(/,| & | x | feat/i)[0].trim();
      title = title.slice(dash + 3);
    }
    return { title: title, artist: artist };
  } catch (e) { return null; }
}

function spotifyToken() {
  // Spotify's public embed player carries an anonymous token in its page data.
  var r = get('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT', { 'User-Agent': DESKTOP_UA });
  if (!r) return null;
  var m = r.body.match(/"accessToken":"([^"]+)"/);
  return m ? m[1] : null;
}

function spotifyApiSearch(song) {
  var token = spotifyToken();
  if (!token) return null;
  var q = 'track:' + searchTitle(song.title) + (song.artist ? ' artist:' + song.artist : '');
  var r = get('https://api.spotify.com/v1/search?type=track&limit=8&q=' + encodeURIComponent(q),
              { 'Authorization': 'Bearer ' + token });
  if (!r) return null;
  try {
    var items = JSON.parse(r.body).tracks.items;
    var best = null, bestScore = 0;
    for (var i = 0; i < items.length; i++) {
      var t = items[i];
      var artists = [];
      for (var a = 0; a < t.artists.length; a++) artists.push(t.artists[a].name);
      var ts = similar(t.name, song.title), as = similar(artists.join(' '), song.artist);
      if (ts < 0.8 || (song.artist && as < 0.5)) continue;
      var score = ts * 2 + as - (VARIANT.test(t.name) && !VARIANT.test(song.title) ? 1 : 0) - i * 0.01;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (best) return 'https://open.spotify.com/track/' + best.id;
    why = 'no close match';
  } catch (e) { why = 'search failed'; }
  return null;
}

function webSearchSpotify(song) {
  var q = 'site:open.spotify.com/track ' + searchTitle(song.title) + ' ' + song.artist;
  var pages = [
    'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q),
    'https://www.bing.com/search?q=' + encodeURIComponent(q)
  ];
  for (var i = 0; i < pages.length; i++) {
    var r = get(pages[i], { 'User-Agent': DESKTOP_UA });
    if (!r) continue;
    var text = unescapeJson(r.body).replace(/&amp;/g, '&');
    var wrapped = text.match(/uddg=[^&"']+/g) || [];
    for (var w = 0; w < wrapped.length; w++) {
      try { text += ' ' + decodeURIComponent(wrapped[w].slice(5)); } catch (e) {}
    }
    var m = text.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})/);
    if (m) return 'https://open.spotify.com/track/' + m[1];
    why = 'no result';
  }
  return null;
}

function youtubeToSpotify(link) {
  var id = videoId(link);
  var ytLink = id ? 'https://www.youtube.com/watch?v=' + id : link.replace('music.youtube.com', 'www.youtube.com');
  if (!id) return { action: 'whatsapp', url: ytLink };
  toast('Finding it on Spotify…');
  var song = ytSong(id);
  var sp = song ? (spotifyApiSearch(song) || webSearchSpotify(song)) : null;
  if (sp) return { action: 'whatsapp', url: sp };
  return { action: 'whatsapp', url: ytLink, toast: 'Not found on Spotify (' + why + '), sent a YouTube link' };
}

// ---------- Spotify -> YouTube Music ----------

function spotifySong(link) {
  var url = link.split('?')[0];
  var r = get(url, { 'User-Agent': DESKTOP_UA });
  if (!r) return null;
  var html = r.body;
  // Short links (spotify.link) land on a page that points at the real track.
  if (!/open\.spotify\.com\/(intl-[a-z]{2}\/)?track\//.test(r.url)) {
    var m = unescapeJson(html).match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]{22}/);
    if (!m) { why = 'not a song link'; return null; }
    r = get('https://' + m[0], { 'User-Agent': DESKTOP_UA });
    if (!r) return null;
    html = r.body;
  }
  var title = meta(html, 'og:title');
  var artist = meta(html, 'music:musician_description');
  if (!artist) {
    // Page title: "Song - song and lyrics by Artist | Spotify"
    var pt = html.match(/<title>[^<]*?song(?: and lyrics)? by ([^<|]+?)\s*\|\s*Spotify/i);
    if (pt) artist = decodeEntities(pt[1]);
  }
  if (!artist) {
    // og:description is either "Artist · Album · Song · 2020" or "Listen to X on Spotify. Artist · Song · 2020"
    var parts = meta(html, 'og:description').replace(/^.*on Spotify\.\s*/, '').split(' · ');
    artist = parts[0] === 'Song' ? (parts[1] || '') : (parts[0] || '');
  }
  artist = artist.split(/,\s*/)[0];
  if (!title) { why = 'no song info'; return null; }
  return { title: title, artist: artist };
}

function findYouTubeVideo(song) {
  var q = searchTitle(song.title) + ' ' + song.artist;
  var r = get('https://www.youtube.com/results?search_query=' + encodeURIComponent(q), YT_HEADERS);
  if (!r) return null;
  var parts = r.body.split('"videoRenderer":{');
  var best = null, bestScore = -1;
  for (var i = 1; i < parts.length && i <= 8; i++) {
    var chunk = parts[i].slice(0, 8000);
    var id = chunk.match(/^"videoId":"([\w-]{11})"/);
    if (!id) continue;
    var t = chunk.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
    var o = chunk.match(/"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
    var title = t ? unescapeJson(t[1]) : '';
    var owner = o ? unescapeJson(o[1]) : '';
    var score = similar(title.replace(owner.replace(/ - Topic$/, '') + ' - ', ''), song.title) * 2
              + similar(owner.replace(/ - Topic$/, '').replace(/VEVO$/i, ''), song.artist)
              + (/ - Topic$/.test(owner) ? 0.5 : 0)          // official audio upload
              + (VARIANT.test(title) && !VARIANT.test(song.title) ? -1 : 0)
              - i * 0.05;                                      // slight preference for higher results
    if (score > bestScore) { bestScore = score; best = id[1]; }
  }
  if (!best) why = 'no result';
  return best;
}

function spotifyToYouTube(link) {
  if (!/\/track\/|spotify\.link/.test(link)) {
    return { action: 'open', url: link, pkg: SPOTIFY_PKG, toast: 'Only songs can be swapped, opening in Spotify' };
  }
  toast('Opening in YouTube Music…');
  var song = spotifySong(link);
  if (!song) {
    return { action: 'open', url: link, pkg: SPOTIFY_PKG, toast: 'Couldn\'t read that link (' + why + '), opening Spotify' };
  }
  var vid = findYouTubeVideo(song);
  if (vid) return { action: 'open', url: 'https://music.youtube.com/watch?v=' + vid, pkg: YTM_PKG };
  return {
    action: 'open', pkg: YTM_PKG,
    url: 'https://music.youtube.com/search?q=' + encodeURIComponent(searchTitle(song.title) + ' ' + song.artist),
    toast: 'No exact match (' + why + '), showing search'
  };
}

// ---------- Entry point ----------

function convert(text, source) {
  var m = String(text || '').match(/https?:\/\/[^\s<>"']+/);
  var result;
  if (!m) {
    result = { action: 'error', toast: 'No music link found' };
  } else if (/(open\.spotify\.com|spotify\.link|spotify\.app\.link)/i.test(m[0])) {
    result = spotifyToYouTube(m[0]);
  } else if (/(music\.youtube\.com|youtube\.com|youtu\.be)/i.test(m[0])) {
    result = youtubeToSpotify(m[0]);
  } else {
    result = { action: 'error', toast: 'That isn\'t a Spotify or YouTube Music link' };
  }
  return JSON.stringify(result);
}
