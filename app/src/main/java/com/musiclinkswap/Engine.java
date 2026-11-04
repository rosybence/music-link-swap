package com.musiclinkswap;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

import org.json.JSONObject;
import org.mozilla.javascript.BaseFunction;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;

/**
 * Runs the matching script (logic/convert.js in the GitHub repo).
 * The latest script is fetched on every run, so matching can be improved without reinstalling.
 */
final class Engine {
    private Engine() {}

    static final String SCRIPT_URL =
            "https://raw.githubusercontent.com/" + BuildConfig.REPO + "/main/logic/convert.js";

    /** Latest script from GitHub, else the last good copy, else the copy built into the app. */
    static String loadScript(Context c) {
        File cache = new File(c.getFilesDir(), "convert.js");
        JSONObject r = Net.get(SCRIPT_URL + "?t=" + (System.currentTimeMillis() / 60000), null, 4000);
        String body = r.optString("body", "");
        if (r.optInt("status") == 200 && body.contains("function convert")) {
            try (FileOutputStream out = new FileOutputStream(cache)) {
                out.write(body.getBytes(StandardCharsets.UTF_8));
            } catch (Exception ignored) {
            }
            return body;
        }
        try {
            if (cache.exists()) {
                return Net.read(new java.io.FileInputStream(cache), 1024 * 1024);
            }
        } catch (Exception ignored) {
        }
        try {
            return Net.read(c.getAssets().open("convert.js"), 1024 * 1024);
        } catch (Exception e) {
            return "";
        }
    }

    /** Returns the script's JSON result, or {"action":"error","toast":...}. */
    static JSONObject run(Context c, String input, String source) {
        org.mozilla.javascript.Context cx = org.mozilla.javascript.Context.enter();
        try {
            cx.setOptimizationLevel(-1); // interpreted mode, required on Android
            cx.setLanguageVersion(org.mozilla.javascript.Context.VERSION_ES6);
            ScriptableObject scope = cx.initSafeStandardObjects();

            final Context app = c.getApplicationContext();
            final Handler ui = new Handler(Looper.getMainLooper());

            ScriptableObject.putProperty(scope, "httpGet", new BaseFunction() {
                @Override
                public Object call(org.mozilla.javascript.Context cx, Scriptable s, Scriptable t, Object[] args) {
                    String url = org.mozilla.javascript.Context.toString(args[0]);
                    JSONObject headers = null;
                    if (args.length > 1 && args[1] instanceof CharSequence) {
                        try { headers = new JSONObject(args[1].toString()); } catch (Exception ignored) {}
                    }
                    return Net.get(url, headers, 8000).toString();
                }
            });
            ScriptableObject.putProperty(scope, "toast", new BaseFunction() {
                @Override
                public Object call(org.mozilla.javascript.Context cx, Scriptable s, Scriptable t, Object[] args) {
                    final String msg = org.mozilla.javascript.Context.toString(args[0]);
                    ui.post(() -> Toast.makeText(app, msg, Toast.LENGTH_SHORT).show());
                    return null;
                }
            });

            String src = loadScript(c);
            if (src.isEmpty()) return error("Couldn't load the matching script");
            cx.evaluateString(scope, src, "convert.js", 1, null);
            Object fn = scope.get("convert", scope);
            if (!(fn instanceof Function)) return error("Matching script is broken");
            Object res = ((Function) fn).call(cx, scope, scope, new Object[]{input, source});
            return new JSONObject(org.mozilla.javascript.Context.toString(res));
        } catch (Throwable e) {
            return error("Error: " + e.getMessage());
        } finally {
            org.mozilla.javascript.Context.exit();
        }
    }

    private static JSONObject error(String msg) {
        JSONObject o = new JSONObject();
        try {
            o.put("action", "error");
            o.put("toast", msg);
        } catch (Exception ignored) {
        }
        return o;
    }
}
