/**
 * Rotating welcome greetings — parity with web AppLayout.getGreeting.
 * IST hour buckets + day-seeded pick so the line is stable all day.
 */

const GREETINGS = {
  lateNight: [
    'Up late, {{name}}?',
    'Burning the midnight oil, {{name}}?',
    'The night shift, {{name}}?',
    "Can't sleep, {{name}}?",
    'Night owl mode, {{name}}',
    'Still going, {{name}}?',
    '{{name}}, the world is quiet — perfect time to work',
    'Late nights build empires, {{name}}',
    "Everyone's asleep but {{name}}",
    '{{name}}, coffee or willpower?',
  ],
  morning: [
    'Rise and shine, {{name}}',
    'Good morning, {{name}}',
    "Morning, {{name}} — let's get after it",
    'Fresh day, {{name}}',
    'Top of the morning, {{name}}',
    'Ready to roll, {{name}}?',
    'New day, new wins, {{name}}',
    '{{name}}, the early bird gets the lead',
    "Morning, {{name}} — what's the plan?",
    "{{name}}, today's going to be a good one",
  ],
  afternoon: [
    'Good afternoon, {{name}}',
    'Afternoon, {{name}} — keep the momentum',
    'Halfway there, {{name}}',
    'Hope lunch was good, {{name}}',
    'Afternoon push, {{name}}',
    '{{name}}, powering through the afternoon',
    'Still crushing it, {{name}}',
    "Afternoon, {{name}} — how's the day going?",
    '{{name}}, the finish line is in sight',
    'Keep it rolling, {{name}}',
  ],
  evening: [
    'Good evening, {{name}}',
    'Still at it, {{name}}?',
    'Evening, {{name}} — wrapping up?',
    'Burning the evening oil, {{name}}',
    '{{name}}, almost time to call it a day',
    'Evening hustle, {{name}}',
    'Winding down, {{name}}?',
    '{{name}}, one last push?',
    'Evening, {{name}} — solid day?',
    '{{name}}, the sunset shift',
  ],
} as const;

/** IST-pinned hour so greeting doesn't drift across timezones. */
function istHour(now = new Date()): number {
  return parseInt(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    }).format(now),
    10,
  );
}

export function getGreeting(displayName: string | null | undefined, now = new Date()): string {
  const h = istHour(now);
  const pool =
    h < 5
      ? GREETINGS.lateNight
      : h < 12
        ? GREETINGS.morning
        : h < 17
          ? GREETINGS.afternoon
          : h < 21
            ? GREETINGS.evening
            : GREETINGS.lateNight;
  const dayIndex = (now.getFullYear() * 1000 + now.getMonth() * 32 + now.getDate()) % pool.length;
  const firstName = (displayName || '').split(' ')[0] || 'there';
  return pool[dayIndex].replace(/\{\{name\}\}/g, firstName);
}

export function formatTodaySubtitle(now = new Date()): string {
  return now.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kolkata',
  });
}
