declare module 'react-native-fetch-api' {
  export const fetch: typeof globalThis.fetch;
}

declare module 'react-native-polyfill-globals/src/encoding' {
  export function polyfill(): void;
}

declare module 'react-native-polyfill-globals/src/readable-stream' {
  export function polyfill(): void;
}
