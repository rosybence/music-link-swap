package com.musiclinkswap;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * Invisible screen that receives a link (tapped Spotify link, or Share from YT Music),
 * asks the matching script what to do, then hands off to WhatsApp or YT Music.
 */
public class HandlerActivity extends Activity {
    static final String WHATSAPP = "com.whatsapp";
    static final String WHATSAPP_BIZ = "com.whatsapp.w4b";
    static final String SPOTIFY = "com.spotify.music";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent in = getIntent();
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
        } else if ("open".equals(action) && !url.isEmpty()) {
            open(url, pkg);
        } else if ("view".equals(source)) {
            // Never leave a tapped link dead: fall back to opening it in Spotify.
            open(original, SPOTIFY);
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
