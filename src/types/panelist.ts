export type Panelist = {
  id: string;
  email: string;
  voted: boolean;
  ballot: string[];
  approved: string[];
  disapproved: string[];
  avatar: string;
  username: string;
  discriminator: string;
};
