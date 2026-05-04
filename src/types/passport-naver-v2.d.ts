declare module 'passport-naver-v2' {
  import { Strategy as PassportStrategy } from 'passport';

  interface Profile {
    id: string;
    displayName: string;
    email?: string;
  }

  interface StrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
  }

  type VerifyCallback = (error: unknown, user?: Express.User | false) => void;
  type VerifyFunction = (
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback
  ) => void;

  class Strategy extends PassportStrategy {
    constructor(options: StrategyOptions, verify: VerifyFunction);
  }
}
