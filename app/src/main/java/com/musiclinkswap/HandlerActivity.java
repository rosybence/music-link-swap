package com.musiclinkswap;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.json.JSONObject;

/**
 * Invisible screen that receives a link (tapped Spotify link, or Share from YT Music),
 * asks the matching script what to do, then hands off to WhatsApp or YT Music.
 */
public class HandlerActivity extends Activity {
    static final String WHATSAPP = "com.whatsapp";
    static final String WHATSAPP_BIZ = "com.whatsapp.w4b";
    static final String SPOTIFY = "com.spotify.music";
    static final String ACTION_USE_YOUTUBE = "com.musiclinkswap.USE_YOUTUBE";
    static final String EXTRA_VIDEO = "video";
    static final String CHANNEL_WRONG = "wrong_song";
    static final int NOTIFY_WRONG = 2;
    static final Pattern VIDEO_ID = Pattern.compile("(?:[?&]v=|youtu\\.be/)([\\w-]{11})");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent in = getIntent();

        // "Send YouTube link instead" tapped on the wrong-song notification.
        if (ACTION_USE_YOUTUBE.equals(in.getAction())) {
            String vid = in.getStringExtra(EXTRA_VIDEO);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.cancel(NOTIFY_WRONG);
            if (vid != null) {
                rememberYouTube(vid);
                sendToWhatsApp(youtubeLink(vid));
            }
            finish();
            return;
        }

        final String source;
        final String text;
        if (Intent.ACTION_VIEW.equals(in.getAction()) && in.getData() != null) {
            source = "view";
            text = in.getData().toString();
        } else if (Intent.ACTION_SEND.equals(in.getAction())) {
            source = "share";
            String t = in.getStringExtra(Intent.EXTRA_TEXT);
            text = t == null ? "" : t;
        } else {
            finish();
            return;
        }

        // Songs you've switched to YouTube before go straight to YouTube.
        final String sharedVid = "share".equals(source) ? videoId(text) : null;
        if (sharedVid != null && prefersYouTube(sharedVid)) {
            Toast.makeText(this, "Sending YouTube link (you picked this before)", Toast.LENGTH_SHORT).show();
            sendToWhatsApp(youtubeLink(sharedVid));
            finish();
            return;
        }

        // Rhino needs a bigger stack than Android's default thread gives.
        new Thread(null, () -> {
            JSONObject result = Engine.run(this, text, source);
            runOnUiThread(() -> {
                act(result, text, source);
                finish();
            });
            UpdateChecker.checkInBackground(getApplicationContext(), false);
        }, "convert", 8 * 1024 * 1024).start();
    }

    private void act(JSONObject r, String original, String source) {
        String action = r.optString("action");
        String url = r.optString("url");
        String pkg = r.optString("pkg");
        String toast = r.optString("toast");
        if (!toast.isEmpty()) Toast.makeText(this, toast, Toast.LENGTH_LONG).show();

        if ("whatsapp".equals(action) && !url.isEmpty()) {
            sendToWhatsApp(url);
            String vid = videoId(original);
            if (vid != null && url.contains("spotify.com")) offerYouTubeInstead(vid);
        } else if ("open".equals(action) && !url.isEmpty()) {
            open(url, pkg);
        } else if ("view".equals(source)) {
            // Never leave a tapped link dead: fall back to opening it in Spotify.
            open(original, SPOTIFY);
        }
    }

    static String videoId(String text) {
        if (text == null) return null;
        Matcher m = VIDEO_ID.matcher(text);
        return m.find() ? m.group(1) : null;
    }

    static String youtubeLink(String vid) {
        return "https://www.youtube.com/watch?v=" + vid;
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("mls", Context.MODE_PRIVATE);
    }

    private boolean prefersYouTube(String vid) {
        return prefs().getStringSet("useYouTube", new HashSet<>()).contains(vid);
    }

    private void rememberYouTube(String vid) {
        Set<String> set = new HashSet<>(prefs().getStringSet("useYouTube", new HashSet<>()));
        set.add(vid);
        prefs().edit().putStringSet("useYouTube", set).apply();
    }

    /** Shows a short-lived notification with a button to send the YouTube link instead. */
    private void offerYouTubeInstead(String vid) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(
                CHANNEL_WRONG, "Wrong song button", NotificationManager.IMPORTANCE_HIGH));
        Intent i = new Intent(this, HandlerActivity.class)
                .setAction(ACTION_USE_YOUTUBE)
                .putExtra(EXTRA_VIDEO, vid)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, 0, i,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CHANNEL_WRONG)
                .setSmallIcon(android.R.drawable.ic_menu_revert)
                .setContentTitle("Wrong song on Spotify?")
                .setContentText("Tap to send the YouTube link instead")
                .setContentIntent(pi)
                .addAction(new Notification.Action.Builder(null, "Send YouTube link instead", pi).build())
                .setAutoCancel(true)
                .setTimeoutAfter(3 * 60 * 1000)
                .build();
        try {
            nm.notify(NOTIFY_WRONG, n);
        } catch (SecurityException ignored) {
        }
    }

    private boolean installed(String pkg) {
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void sendToWhatsApp(String text) {
        Intent send = new Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, text)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (installed(WHATSAPP)) send.setPackage(WHATSAPP);
        else if (installed(WHATSAPP_BIZ)) send.setPackage(WHATSAPP_BIZ);
        else send = Intent.createChooser(send, "Send link").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(send);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Couldn't open WhatsApp", Toast.LENGTH_LONG).show();
        }
    }

    private void open(String url, String pkg) {
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        boolean spotifyUrl = url.contains("spotify.com") || url.contains("spotify.link");
        if (!pkg.isEmpty() && installed(pkg)) {
            view.setPackage(pkg);
        } else if (spotifyUrl) {
            // Without an explicit app this would loop straight back to us.
            if (installed(SPOTIFY)) view.setPackage(SPOTIFY);
            else view.addCategory(Intent.CATEGORY_BROWSABLE).setPackage("com.android.chrome");
        }
        try {
            startActivity(view);
        } catch (ActivityNotFoundException e) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception ignored) {
                Toast.makeText(this, "Couldn't open the link", Toast.LENGTH_LONG).show();
            }
        }
    }
}
