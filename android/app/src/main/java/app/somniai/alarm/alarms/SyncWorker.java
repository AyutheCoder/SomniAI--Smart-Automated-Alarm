package app.somniai.alarm.alarms;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * Sends the queued ring results when WorkManager sees a network. If the server
 * can't take them yet (down, not signed in), it asks to be retried with
 * backoff; nothing is lost in between.
 */
public class SyncWorker extends Worker {

    public SyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        // Again until empty or stuck, so results queued during a send go out too.
        for (int round = 0; round < 5; round++) {
            OutboxQueue.Flush f = Outbox.flushNow(getApplicationContext());
            if (f.stalled) {
                return Result.retry();
            }
            if (Outbox.queue(getApplicationContext()).size() == 0) {
                return Result.success();
            }
        }
        return Result.retry();
    }
}
