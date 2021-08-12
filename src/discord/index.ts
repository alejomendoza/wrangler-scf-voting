import { handleResponse } from '../utils';

export const discordApiUrl = 'https://discord.com/api';
export const discordUserUrl = `${discordApiUrl}/users/@me`;
export const discordServerUrl = `${discordApiUrl}/guilds/831188872536784947`;

export async function fetchDiscordUser(token: string) {
  return await fetch(discordUserUrl, {
    cf: {
      cacheTtlByStatus: { '200-299': 300 },
    },
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }).then(handleResponse);
}

export async function fetchDiscordGuildMember(token: string, id: string) {
  return await fetch(`${discordServerUrl}/members/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }).then(handleResponse);
}
