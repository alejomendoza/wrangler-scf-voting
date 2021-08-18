import { handleResponse } from '../utils';

export const discordApiUrl = 'https://discord.com/api';
export const discordUserUrl = `${discordApiUrl}/users/@me`;
export const scfGuildId = '831188872536784947';
export const discordServerUrl = `${discordApiUrl}/guilds/${scfGuildId}`;
export const discordServerRoles = `${discordApiUrl}/guilds/${scfGuildId}/roles`;
export const adminRoleId = '845026552286937119';
export const verifiedRoleId = '831189270344630293';

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

export async function fetchDiscordGuildMember(id: string) {
  return await fetch(`${discordServerUrl}/members/${id}`, {
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
    },
  }).then(handleResponse);
}

export async function fetchDiscordRoles() {
  return await fetch(`${discordServerRoles}`, {
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
    },
  }).then(handleResponse);
}
