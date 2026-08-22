export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: Date;
}

export interface CreateUserDTO {
  username: string;
  email: string;
}
