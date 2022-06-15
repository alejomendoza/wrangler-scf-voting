import { handleResponse } from '.';

export enum role {
  ADMIN = '845026552286937119',
  VERIFIED = '831189270344630293',
  SUBMITTER = '879828995833724948',
  VOTER = '887005159606079489',
  SCF10 = '982331569664585768',
}

export const discordApiUrl = 'https://discord.com/api';
export const discordUserUrl = `${discordApiUrl}/users/@me`;
export const scfGuildId = '831188872536784947';
export const discordServerUrl = `${discordApiUrl}/guilds/${scfGuildId}`;
export const discordServerRoles = `${discordApiUrl}/guilds/${scfGuildId}/roles`;

export async function fetchDiscordUser(token: string): Promise<DiscordUser> {
  return await fetch(discordUserUrl, {
    cf: {
      cacheTtlByStatus: { '200-299': 300 },
    },
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }).then(handleResponse);
}

export async function fetchDiscordGuildMember(
  id: string,
  botToken: string,
): Promise<GuildMember> {
  return await fetch(`${discordServerUrl}/members/${id}`, {
    headers: {
      Authorization: `Bot ${botToken}`,
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
