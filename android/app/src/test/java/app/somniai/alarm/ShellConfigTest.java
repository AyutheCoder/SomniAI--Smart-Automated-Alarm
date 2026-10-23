package app.somniai.alarm;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;

/**
 * Checks the shell configuration that is packaged into the APK, as written by
 * `npx cap sync` from capacitor.config.ts. The shell loads the app from a
 * server (see ANDROID.md), so what it may load and where it may go are the
 * security boundary of the native bridge.
 */
public class ShellConfigTest {

    /** Unit tests run with the app module as the working directory. */
    private static final File ASSETS = new File("src/main/assets");

    private JSONObject config;
    private JSONObject server;

    @Before
    public void readPackagedConfig() throws Exception {
        File file = new File(ASSETS, "capacitor.config.json");
        assertTrue("run `npx cap sync android` first: " + file.getAbsolutePath(), file.isFile());
        config = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        server = config.getJSONObject("server");
    }

    @Test
    public void identifiesTheApp() throws Exception {
        assertEquals("app.somniai.alarm", config.getString("appId"));
        assertEquals("SomniAI", config.getString("appName"));
    }

    @Test
    public void allowsPlainHttpOnlyForAnHttpServer() throws Exception {
        URI url = new URI(server.getString("url"));
        boolean http = "http".equals(url.getScheme());
        assertTrue("server url must be http or https", http || "https".equals(url.getScheme()));
        assertEquals("cleartext must match the server's scheme", http, server.optBoolean("cleartext", false));
    }

    @Test
    public void navigatesOnlyWithinItsOwnServer() throws Exception {
        URI url = new URI(server.getString("url"));
        String host = url.getPort() == -1 ? url.getHost() : url.getHost() + ":" + url.getPort();
        JSONArray allowed = server.getJSONArray("allowNavigation");
        assertEquals(1, allowed.length());
        assertEquals(host, allowed.getString(0));
        assertFalse("no wildcards", allowed.getString(0).contains("*"));
    }

    @Test
    public void hasAnOfflinePageWhenTheServerIsUnreachable() throws Exception {
        String errorPath = server.getString("errorPath");
        assertTrue("the error page is packaged: " + errorPath, new File(ASSETS, "public/" + errorPath).isFile());
    }
}
