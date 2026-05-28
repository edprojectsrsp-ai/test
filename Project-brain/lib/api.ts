const API_BASE = "http://localhost:8002/api/v1";

export const capexApi = {
  getData: async () => {
    const res = await fetch(`${API_BASE}/capex`);
    return res.json();
  },

  saveData: async (data: any) => {
    const res = await fetch(`${API_BASE}/capex/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.json();
  }
};

export const api = {
  login: async (username: string, password: string) => {
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password }),
    });
    return res.json();
  },

  register: async (data: any) => {
    const res = await fetch(`${API_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.json();
  }
};

