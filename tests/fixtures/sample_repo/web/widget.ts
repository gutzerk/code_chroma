// Small widget that renders a user's slug, mirroring the shared slugify convention.
export function renderUserSlug(name: string): string {
    const slug = name.trim().toLowerCase().replace(/\s+/g, "-");
    return `<span class="slug">${slug}</span>`;
}
