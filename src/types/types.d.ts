type Project = {
  id: string;
  score: number;
  approved_count: number;
  description: string;
  name: string;
  site: string;
  logoUrl: string;
  slug: string;
};

type ProjectInfo = {
  name: string;
  slug: string;
};

interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string;
  bot?: boolean;
  system?: boolean;
  mfa_enabled?: boolean;
  banner?: string;
  accent_color?: number;
  locale?: string;
  verified?: boolean;
  email?: string;
  flags?: number;
  premium_type?: number;
  public_flags?: number;
}

interface GuildMember {
  user?: DiscordUser;
  nick?: string;
  avatar?: string;
  roles: string[];
  joined_at: string;
  premium_since?: string;
  deaf: boolean;
  mute: boolean;
  pending?: boolean;
  permissions?: string;
  communication_disabled_until?: string;
}

interface Panelist extends DiscordUser {
  voted: boolean;
  favorites: ProjectInfo[];
  approved: ProjectInfo[];
  isAdmin: boolean;
}
