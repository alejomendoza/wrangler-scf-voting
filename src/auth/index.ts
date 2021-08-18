import { fromPairs as loFromPairs } from 'lodash';
import { bearer } from '@borderless/parse-authorization';
import {
  adminRoleId,
  fetchDiscordGuildMember,
  fetchDiscordUser,
  verifiedRoleId,
} from '../discord';

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

  const { roles }: { roles: string[] } = await fetchDiscordGuildMember(token);

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

  if (!roles.includes(verifiedRoleId) || !roles.includes(adminRoleId)) {
    throw {
      status: 404,
      message: 'Discord user missing required roles',
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
