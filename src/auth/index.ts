import { fromPairs as loFromPairs } from 'lodash';
import { bearer } from '@borderless/parse-authorization';
import { fetchDiscordGuildMember, fetchDiscordUser } from '../discord';

export async function handleAuth(request: Request) {
  const headers = loFromPairs([...new Map(request.headers)]);
  const token = bearer(headers.authorization || '');
  if (!token) {
    throw { status: 401, message: 'Missing Authorization header token' };
  }
  const {
    id,
    email,
    verified,
    avatar,
    username,
    discriminator,
  } = await fetchDiscordUser(token);

  const { roles }: { roles: string[] } = await fetchDiscordGuildMember(
    token,
    id,
  );

  if (!id) {
    throw {
      status: 404,
      message: 'Failed to authenticate',
    };
  }

  if (!verified) {
    throw {
      status: 404,
      message: 'Discord user missing or the email is unverified',
    };
  }

  if (!roles.includes('panelist')) {
    throw {
      status: 404,
      message: 'Discord user missing panelist role',
    };
  }

  return {
    id,
    email,
    avatar,
    username,
    discriminator,
  };
}
