export interface TestClock {
  now(): Date;
}

export function createFixedClock(instant: string | Date): TestClock {
  const fixed = new Date(instant);

  if (Number.isNaN(fixed.getTime())) {
    throw new Error('Fixed test clock requires a valid instant.');
  }

  return {
    now: () => new Date(fixed.getTime()),
  };
}

export function deterministicId(prefix: string, sequence: number): string {
  if (!/^[a-z][a-z0-9-]*$/i.test(prefix) || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('Deterministic ID requires a safe prefix and positive integer sequence.');
  }

  return `${prefix}-${sequence.toString().padStart(6, '0')}`;
}
