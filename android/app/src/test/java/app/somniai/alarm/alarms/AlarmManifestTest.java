package app.somniai.alarm.alarms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * The permissions and receivers the alarm code depends on, read from the
 * manifests themselves: a missing or widened declaration fails here rather
 * than on someone's phone at 6am.
 */
public class AlarmManifestTest {

    static final String ANDROID = "http://schemas.android.com/apk/res/android";

    static Document read(String path) throws Exception {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setNamespaceAware(true);
        return f.newDocumentBuilder().parse(new File(path));
    }

    static Map<String, Element> byName(Document doc, String tag) {
        Map<String, Element> out = new HashMap<>();
        NodeList nodes = doc.getElementsByTagName(tag);
        for (int i = 0; i < nodes.getLength(); i++) {
            Element e = (Element) nodes.item(i);
            out.put(e.getAttributeNS(ANDROID, "name"), e);
        }
        return out;
    }

    static Set<String> actions(Element receiver) {
        Set<String> out = new HashSet<>();
        NodeList nodes = receiver.getElementsByTagName("action");
        for (int i = 0; i < nodes.getLength(); i++) {
            out.add(((Element) nodes.item(i)).getAttributeNS(ANDROID, "name"));
        }
        return out;
    }

    @Test
    public void exactAlarmPermissionsAreDeclaredPerAndroidVersion() throws Exception {
        Map<String, Element> perms = byName(read("src/main/AndroidManifest.xml"), "uses-permission");
        Element use = perms.get("android.permission.USE_EXACT_ALARM");
        assertNotNull("USE_EXACT_ALARM (Android 13+)", use);
        assertEquals("", use.getAttributeNS(ANDROID, "maxSdkVersion"));
        Element schedule = perms.get("android.permission.SCHEDULE_EXACT_ALARM");
        assertNotNull("SCHEDULE_EXACT_ALARM (Android 12/12L)", schedule);
        assertEquals("only where USE_EXACT_ALARM does not exist", "32", schedule.getAttributeNS(ANDROID, "maxSdkVersion"));
        assertNotNull(perms.get("android.permission.RECEIVE_BOOT_COMPLETED"));
        assertNotNull(perms.get("android.permission.POST_NOTIFICATIONS"));
    }

    @Test
    public void theRescheduleReceiverListensForExactlyWhatItHandles() throws Exception {
        Element r = byName(read("src/main/AndroidManifest.xml"), "receiver").get(".alarms.RescheduleReceiver");
        assertNotNull(r);
        assertEquals(RescheduleReceiver.ACTIONS, actions(r));
        assertEquals("false", r.getAttributeNS(ANDROID, "exported"));
        assertEquals("runs before the first unlock after a reboot", "true", r.getAttributeNS(ANDROID, "directBootAware"));
        assertTrue(actions(r).contains("android.intent.action.LOCKED_BOOT_COMPLETED"));
        assertTrue(actions(r).contains("android.intent.action.TIME_SET"));
        assertTrue(actions(r).contains("android.intent.action.TIMEZONE_CHANGED"));
        assertTrue(actions(r).contains("android.intent.action.MY_PACKAGE_REPLACED"));
    }

    @Test
    public void theFiredReceiverIsPrivateAndDirectBootAware() throws Exception {
        Element r = byName(read("src/main/AndroidManifest.xml"), "receiver").get(".alarms.AlarmFiredReceiver");
        assertNotNull(r);
        assertEquals("false", r.getAttributeNS(ANDROID, "exported"));
        assertEquals("true", r.getAttributeNS(ANDROID, "directBootAware"));
        assertTrue("reached only by its PendingIntent", actions(r).isEmpty());
    }

    @Test
    public void theAdbTestHookIsDebugOnlyAndShellOnly() throws Exception {
        assertNull(byName(read("src/main/AndroidManifest.xml"), "receiver").get(".alarms.DebugAlarmReceiver"));
        Element r = byName(read("src/debug/AndroidManifest.xml"), "receiver").get(".alarms.DebugAlarmReceiver");
        assertNotNull(r);
        assertEquals("android.permission.DUMP", r.getAttributeNS(ANDROID, "permission"));
    }

    @Test
    public void supportsAndroid8AndUp() throws Exception {
        String vars = new String(Files.readAllBytes(new File("../variables.gradle").toPath()), "UTF-8");
        Matcher m = Pattern.compile("minSdkVersion\\s*=\\s*(\\d+)").matcher(vars);
        assertTrue(m.find());
        assertEquals("Android 8.0; java.time is used without desugaring", 26, Integer.parseInt(m.group(1)));
    }
}
