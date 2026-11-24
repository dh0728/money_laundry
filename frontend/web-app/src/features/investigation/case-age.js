export const cautionAgeDays = 3;

export function isOverdueCaseAge(days) {
  return days > cautionAgeDays;
}
