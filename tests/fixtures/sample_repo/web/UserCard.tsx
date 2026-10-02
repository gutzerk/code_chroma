/** UserCard renders a single user's summary card. */
export function UserCard(name: string): string {
    return `<div class="user-card">${name}</div>`;
}

export function trackUserCardView(name: string): void {
    console.log(name);
}
