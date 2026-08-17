import { ApiClient, type User } from "@monorepo/api-client";

export class UserService {
  private apiClient: ApiClient;

  constructor(apiUrl: string) {
    this.apiClient = new ApiClient(apiUrl);
  }

  async getUser(id: string): Promise<User | null> {
    return this.apiClient.getUser(id);
  }

  async createUser(name: string): Promise<User> {
    return this.apiClient.createUser(name);
  }
}
