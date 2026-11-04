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
// Link previews (like WhatsApp's) get a plain page with the song details in it.
var PREVIEW_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
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

var notes = []; // what each lookup step returned, shown when nothing is found

function spotifyToken() {
  // Spotify's public embed player carries an anonymous token in its page data.
  var r = get('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT', { 'User-Agent': DESKTOP_UA });
  if (!r) { notes.push('token ' + why); return null; }
  var m = r.body.match(/"accessToken":"([^"]+)"/);
  if (!m) notes.push('token missing');
  return m ? m[1] : null;
}

function goodMatch(name, artistNames, song) {
  var ts = similar(name, song.title), as = similar(artistNames, song.artist);
  if (ts < 0.8 || (song.artist && artistNames && as < 0.5)) return -1;
  return ts * 2 + as - (VARIANT.test(name) && !VARIANT.test(song.title) ? 1 : 0);
}

function spotifyApiSearch(song) {
  var token = spotifyToken();
  if (!token) return null;
  var q = 'track:' + searchTitle(song.title) + (song.artist ? ' artist:' + song.artist : '');
  var r = get('https://api.spotify.com/v1/search?type=track&limit=8&q=' + encodeURIComponent(q),
              { 'Authorization': 'Bearer ' + token });
  if (!r) { notes.push('api ' + why); return null; }
  try {
    var items = JSON.parse(r.body).tracks.items;
    var best = null, bestScore = -1;
    for (var i = 0; i < items.length; i++) {
      var t = items[i];
      var artists = [];
      for (var a = 0; a < t.artists.length; a++) artists.push(t.artists[a].name);
      var score = goodMatch(t.name, artists.join(' '), song) - i * 0.01;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (best && bestScore >= 0) return 'https://open.spotify.com/track/' + best.id;
    notes.push('api no close match');
  } catch (e) { notes.push('api unreadable'); }
  return null;
}

var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64urlDecode(s) {
  s = s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  var out = '', buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) {
    var v = B64.indexOf(s.charAt(i));
    if (v < 0) break;
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 255); }
  }
  return out;
}

// Pull every Spotify track ID out of a search results page, in order.
function trackIdsIn(html) {
  var text = unescapeJson(html).replace(/&amp;/g, '&');
  // DuckDuckGo (uddg=) and Google (/url?q=) wrap links; Bing base64-encodes them (u=a1...).
  var extra = '';
  var w = text.match(/(?:uddg|[?&]q|[?&]url)=https?%3A%2F%2Fopen\.spotify\.com[^&"' ]+/gi) || [];
  for (var i = 0; i < w.length; i++) {
    try { extra += ' ' + decodeURIComponent(w[i].replace(/^[^=]*=/, '')); } catch (e) {}
  }
  var bw = text.match(/[?&]u=a1([A-Za-z0-9_-]+)/g) || [];
  for (var j = 0; j < bw.length; j++) extra += ' ' + b64urlDecode(bw[j].replace(/^.*u=a1/, ''));
  text = extra + ' ' + text;
  var ids = [], re = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})/g, m;
  while ((m = re.exec(text)) !== null) if (ids.indexOf(m[1]) === -1) ids.push(m[1]);
  return ids;
}

// Check a candidate is really this song by reading its Spotify page.
function verify(id, song) {
  var r = get('https://open.spotify.com/track/' + id, { 'User-Agent': PREVIEW_UA });
  if (!r) return 0; // can't check
  var s = fromPage(r.body);
  if (!s) return 0;
  return goodMatch(s.title, s.artist, song) >= 0 ? 1 : -1;
}

function webSearchSpotify(song) {
  var q = searchTitle(song.title) + ' ' + song.artist + ' site:open.spotify.com/track';
  var engines = [
    ['ddg', 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), DESKTOP_UA],
    ['google', 'https://www.google.com/search?hl=en&gbv=1&q=' + encodeURIComponent(q), 'Lynx/2.9.0 libwww-FM/2.14'],
    ['bing', 'https://www.bing.com/search?q=' + encodeURIComponent(q), DESKTOP_UA],
    ['brave', 'https://search.brave.com/search?q=' + encodeURIComponent(q), DESKTOP_UA],
    ['mojeek', 'https://www.mojeek.com/search?q=' + encodeURIComponent(q), DESKTOP_UA]
  ];
  for (var i = 0; i < engines.length; i++) {
    var r = get(engines[i][1], { 'User-Agent': engines[i][2], 'Cookie': 'CONSENT=YES+1; SOCS=CAI' });
    if (!r) { notes.push(engines[i][0] + ' ' + why); continue; }
    var ids = trackIdsIn(r.body);
    if (!ids.length) { notes.push(engines[i][0] + ' none'); continue; }
    var fallback = null;
    for (var k = 0; k < ids.length && k < 3; k++) {
      var v = verify(ids[k], song);
      if (v === 1) return 'https://open.spotify.com/track/' + ids[k];
      if (v === 0 && !fallback) fallback = ids[k];
    }
    if (fallback) return 'https://open.spotify.com/track/' + fallback;
    notes.push(engines[i][0] + ' wrong songs');
  }
  return null;
}

function youtubeToSpotify(link) {
  var id = videoId(link);
  var ytLink = id ? 'https://www.youtube.com/watch?v=' + id : link.replace('music.youtube.com', 'www.youtube.com');
  if (!id) return { action: 'whatsapp', url: ytLink, toast: 'Couldn\'t read that YouTube link, sent it as is' };
  toast('Finding it on Spotify…');
  var song = ytSong(id);
  if (!song) notes.push('song info ' + why);
  var sp = song ? (spotifyApiSearch(song) || webSearchSpotify(song)) : null;
  if (sp) return { action: 'whatsapp', url: sp };
  return { action: 'whatsapp', url: ytLink,
           toast: 'Not found on Spotify: ' + (song ? song.title + ' / ' + song.artist + ' | ' : '') + notes.join(', ') };
}

// ---------- Spotify -> YouTube Music ----------


function trackId(text) {
  var m = unescapeJson(text || '').match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

// Song details from a normal Spotify page (meta tags / <title>).
function fromPage(html) {
  var title = meta(html, 'og:title') || meta(html, 'twitter:title');
  var artist = meta(html, 'music:musician_description');
  var pt = html.match(/<title>([^<]*)<\/title>/i);
  pt = pt ? decodeEntities(pt[1]) : '';
  // "Song - song and lyrics by Artist | Spotify"
  var byM = pt.match(/^(.*?) - song(?: and lyrics)? by (.+?)\s*\|\s*Spotify/i);
  if (byM) {
    if (!title) title = byM[1];
    if (!artist) artist = byM[2];
  }
  if (!artist) {
    // "Artist · Album · Song · 2020" or "Listen to X on Spotify. Artist · Song · 2020"
    var parts = (meta(html, 'og:description') || meta(html, 'description'))
      .replace(/^.*on Spotify\.\s*/, '').split(' · ');
    artist = parts[0] === 'Song' ? (parts[1] || '') : (parts[0] || '');
  }
  return title ? { title: title, artist: artist } : null;
}

// Song details from Spotify's embed player data.
function fromEmbed(id) {
  var r = get('https://open.spotify.com/embed/track/' + id, { 'User-Agent': DESKTOP_UA });
  if (!r) return null;
  var t = unescapeJson(r.body);
  var name = t.match(/"type":"track","name":"((?:[^"\\]|\\.)*)"/) || t.match(/"name":"((?:[^"\\]|\\.)*)","uri":"spotify:track:/);
  var artist = t.match(/"artists":\[\{[^\]]*?"name":"((?:[^"\\]|\\.)*)"/) || t.match(/"subtitle":"((?:[^"\\]|\\.)*)"/);
  if (!name) return null;
  return { title: name[1], artist: artist ? artist[1] : '' };
}

function fromOembed(id) {
  var r = get('https://open.spotify.com/oembed?url=' + encodeURIComponent('https://open.spotify.com/track/' + id));
  if (!r) return null;
  try { var j = JSON.parse(r.body); return j.title ? { title: j.title, artist: '' } : null; } catch (e) { return null; }
}

function spotifySong(link) {
  var id = trackId(link);
  if (!id) {
    // Short links (spotify.link) redirect to, or mention, the real track.
    var r0 = get(link, { 'User-Agent': PREVIEW_UA });
    if (r0) id = trackId(r0.url) || trackId(r0.body);
    if (!id) { why = why || 'not a song link'; return null; }
  }
  var page = 'https://open.spotify.com/track/' + id;
  var tried = [], best = null;
  var uas = [PREVIEW_UA, DESKTOP_UA];
  for (var i = 0; i < uas.length; i++) {
    var r = get(page, { 'User-Agent': uas[i] });
    tried.push(r ? 'page ok' : why);
    var s = r ? fromPage(r.body) : null;
    if (s && s.artist) return s;
    if (s && !best) best = s;
  }
  var e = fromEmbed(id);
  tried.push(e ? 'embed ok' : why);
  if (e && e.artist) return e;
  var o = best || e || fromOembed(id);
  if (o) return o; // title only still gives a decent search
  why = 'no song info: ' + tried.join(', ');
  return null;
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
