export function double(value: number): number {
  return value * 2;
}

export const greeting = 'hello devforge';

export interface Greeting {
  readonly text: string;
  readonly greet: (name: string) => string;
}

export function createGreeting(): Greeting {
  return {
    text: greeting,
    greet: (name) => `${greeting}, ${name}`,
  };
}