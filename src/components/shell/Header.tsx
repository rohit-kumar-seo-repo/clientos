export function Header({ adminName }: { adminName: string }) {
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-8 py-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">
          Good {timeOfDayGreeting()}, {adminName}
        </h1>
        <p className="text-sm text-neutral-500">{today}</p>
      </div>
    </header>
  );
}

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
