import type { ButtonProps } from "@monorepo/shared-ui";

export interface User {
  id: string;
  name: string;
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async getUser(id: string): Promise<User | null> {
    const res = await fetch(`${this.baseUrl}/users/${id}`);
    if (!res.ok) return null;
    return res.json();
  }

  async createUser(name: string): Promise<User> {
    const res = await fetch(`${this.baseUrl}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return res.json();
  }

  getButtonProps(): ButtonProps {
    return {
      label: "Save",
      onClick: () => console.log("clicked"),
      variant: "primary",
    };
  }
}
