package app.somniai.alarm.alarms;

import android.content.Context;
import android.content.Intent;
import androidx.activity.result.contract.ActivityResultContract;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.PermissionController;
import androidx.health.connect.client.permission.HealthPermission;
import androidx.health.connect.client.records.Record;
import androidx.health.connect.client.records.RestingHeartRateRecord;
import androidx.health.connect.client.records.SleepSessionRecord;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.response.ReadRecordsResponse;
import androidx.health.connect.client.time.TimeRangeFilter;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.jvm.JvmClassMappingKt;
import kotlin.reflect.KClass;
import kotlinx.coroutines.BuildersKt;

/**
 * Health Connect, read-only (prompt 4.2): whether it's on this phone, the two
 * read permissions, and the last two weeks of sleep sessions and resting heart
 * rate, mapped for HealthNights to fold into nights. The SDK's calls are Kotlin
 * coroutines; they are run to completion here, so never call these on the
 * main thread.
 */
final class HealthConnect {

    /** The Health Connect app, which provides it on Android 13 and earlier. */
    static final String PROVIDER = "com.google.android.apps.healthdata";
    /** How far back each read goes: a night a watch synced late is read again. */
    static final int DAYS = 14;

    static final Set<String> PERMISSIONS = new LinkedHashSet<>(List.of(
        HealthPermission.Companion.getReadPermission(kclass(SleepSessionRecord.class)),
        HealthPermission.Companion.getReadPermission(kclass(RestingHeartRateRecord.class))));

    private HealthConnect() {}

    @SuppressWarnings("unchecked")
    private static <T extends Record> KClass<T> kclass(Class<T> c) {
        return JvmClassMappingKt.getKotlinClass(c);
    }

    /** "available", or why not: "not_installed" or "update_required". */
    static String status(Context context) {
        int s = HealthConnectClient.Companion.getSdkStatus(context, PROVIDER);
        if (s == HealthConnectClient.SDK_AVAILABLE) {
            return "available";
        }
        return s == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ? "update_required" : "not_installed";
    }

    /** Runs a suspend call to completion on this thread. */
    @SuppressWarnings("unchecked")
    private static <T> T await(kotlin.jvm.functions.Function1<kotlin.coroutines.Continuation<? super T>, Object> call)
            throws InterruptedException {
        return (T) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, continuation) -> call.invoke((kotlin.coroutines.Continuation<? super T>) continuation));
    }

    private static HealthConnectClient client(Context context) {
        return HealthConnectClient.Companion.getOrCreate(context, PROVIDER);
    }

    /** Which of SomniAI's two read permissions are granted. */
    static Set<String> granted(Context context) throws InterruptedException {
        PermissionController pc = client(context).getPermissionController();
        Set<String> all = await(cont -> pc.getGrantedPermissions(cont));
        Set<String> ours = new LinkedHashSet<>(all);
        ours.retainAll(PERMISSIONS);
        return ours;
    }

    /** Health Connect's own permission screen, for both permissions. */
    static ActivityResultContract<Set<String>, Set<String>> permissionContract() {
        return PermissionController.Companion.createRequestPermissionResultContract(PROVIDER);
    }

    static Intent permissionIntent(Context context) {
        return permissionContract().createIntent(context, PERMISSIONS);
    }

    private static <T extends Record> List<T> readAll(HealthConnectClient c, Class<T> type, Instant from, Instant to)
            throws InterruptedException {
        List<T> out = new ArrayList<>();
        String page = null;
        do {
            ReadRecordsRequest<T> request = new ReadRecordsRequest<>(kclass(type), TimeRangeFilter.Companion.between(from, to),
                Collections.emptySet(), true, 1000, page);
            ReadRecordsResponse<T> response = await(cont -> c.readRecords(request, cont));
            out.addAll(response.getRecords());
            page = response.getPageToken();
        } while (page != null && !page.isEmpty());
        return out;
    }

    /** The last two weeks, folded into nights. Only what has been granted is read. */
    static HealthNights.Result readNights(Context context, Instant now, java.time.ZoneId zone) throws InterruptedException {
        HealthConnectClient c = client(context);
        Set<String> granted = granted(context);
        Instant from = now.minus(DAYS, ChronoUnit.DAYS);
        List<HealthNights.Session> sessions = new ArrayList<>();
        if (granted.contains(HealthPermission.Companion.getReadPermission(kclass(SleepSessionRecord.class)))) {
            for (SleepSessionRecord r : readAll(c, SleepSessionRecord.class, from, now.plus(1, ChronoUnit.DAYS))) {
                List<HealthNights.Stage> stages = new ArrayList<>();
                for (SleepSessionRecord.Stage s : r.getStages()) {
                    stages.add(new HealthNights.Stage(s.getStartTime(), s.getEndTime(), s.getStage()));
                }
                sessions.add(new HealthNights.Session(r.getMetadata().getId(), r.getStartTime(), r.getEndTime(),
                    r.getMetadata().getDataOrigin().getPackageName(), stages));
            }
        }
        List<HealthNights.HeartRate> heart = new ArrayList<>();
        if (granted.contains(HealthPermission.Companion.getReadPermission(kclass(RestingHeartRateRecord.class)))) {
            for (RestingHeartRateRecord r : readAll(c, RestingHeartRateRecord.class, from, now)) {
                heart.add(new HealthNights.HeartRate(r.getTime(), r.getBeatsPerMinute()));
            }
        }
        return HealthNights.fold(sessions, heart, zone, now);
    }
}
