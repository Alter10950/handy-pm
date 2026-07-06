import type { TodayActivity } from "@/lib/dashboard/queries";

export function TodayActivityPanel({ activity }: { activity: TodayActivity }) {
  const nothingHappened =
    activity.installsToday.length === 0 &&
    activity.newBlockersToday === 0 &&
    activity.crewsWorkingToday.length === 0;

  if (nothingHappened) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing logged yet today.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      {activity.crewsWorkingToday.length > 0 ? (
        <p className="text-foreground">
          <span className="font-medium">{activity.crewsWorkingToday.length}</span>{" "}
          crew{activity.crewsWorkingToday.length === 1 ? "" : "s"} working today:{" "}
          <span className="text-muted-foreground">
            {activity.crewsWorkingToday.join(", ")}
          </span>
        </p>
      ) : null}
      {activity.installsToday.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {activity.installsToday.map((entry) => (
            <li key={entry.projectId} className="text-muted-foreground">
              <span className="font-medium text-foreground">{entry.qty}</span> units
              installed — {entry.projectName}
            </li>
          ))}
        </ul>
      ) : null}
      {activity.newBlockersToday > 0 ? (
        <p className="text-destructive">
          {activity.newBlockersToday} new blocker
          {activity.newBlockersToday === 1 ? "" : "s"} reported today
        </p>
      ) : null}
    </div>
  );
}
