export type ProjectInfo = {
  name: string;
  slug: string;
};

export type Panelist = {
  id: string;
  email: string;
  voted: boolean;
  favorites: ProjectInfo[];
  approved: ProjectInfo[];
  avatar: string;
  username: string;
  discriminator: string;
  role: 'verified' | 'admin';
};
