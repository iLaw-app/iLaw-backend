import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';

export const OAUTH_PROVIDER_TIMEOUT_MS = 5_000;

export class OAuthCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthCredentialError';
  }
}

export class OAuthProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthProviderUnavailableError';
  }
}

export type OAuthIdentity = { providerId: string; email?: string };

export async function verifyKakaoAccessToken(accessToken: string): Promise<OAuthIdentity> {
  try {
    const { data } = await axios.get('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: OAUTH_PROVIDER_TIMEOUT_MS,
    });
    if (data?.id === undefined || data?.id === null) {
      throw new OAuthProviderUnavailableError('Kakao returned an invalid profile');
    }
    return { providerId: String(data.id), email: data.kakao_account?.email };
  } catch (error) {
    if (error instanceof OAuthProviderUnavailableError) throw error;
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 400 || status === 401 || status === 403) {
        throw new OAuthCredentialError('Invalid Kakao access token');
      }
      throw new OAuthProviderUnavailableError('Kakao login provider is unavailable');
    }
    throw error;
  }
}

async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new OAuthProviderUnavailableError('OAuth provider request timed out')),
      OAUTH_PROVIDER_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function verifyGoogleIdToken(
  idToken: string,
  client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID),
): Promise<OAuthIdentity> {
  try {
    const ticket = await withTimeout(client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    }));
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new OAuthCredentialError('Invalid Google id token');
    return { providerId: payload.sub, email: payload.email };
  } catch (error) {
    if (error instanceof OAuthProviderUnavailableError || error instanceof OAuthCredentialError) throw error;
    throw new OAuthCredentialError('Invalid Google id token');
  }
}
