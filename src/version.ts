declare const __VERSION__: string | undefined;

/** 빌드할 때 package.json의 버전으로 채운다. 번들을 거치지 않고 실행하면 개발용 값이다. */
export const VERSION: string = typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0-dev";
