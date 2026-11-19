export {}; // a module, like the other pages, so its names stay out of the global scope

interface PickerItem {
  id: string;
  displayName: string;
  url: string;
  columns: number;
  rows: number;
  chosen: boolean;
}
declare const picker: { list(): Promise<PickerItem[]>; choose(id: string): void; install(): void; onChanged(cb: () => void): void };

const grid = document.getElementById('pets')!;

async function render(): Promise<void> {
  const items = await picker.list();
  grid.replaceChildren(
    ...items.map((p) => {
      const button = document.createElement('button');
      button.className = 'pet';
      button.dataset.id = p.id;
      button.setAttribute('aria-pressed', String(p.chosen));
      const art = document.createElement('div');
      art.className = 'art';
      art.style.backgroundImage = `url("${p.url}")`;
      art.style.backgroundSize = `${p.columns * 96}px ${p.rows * 104}px`;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.displayName; // from a downloaded pet.json, so text only
      name.title = p.displayName;
      button.append(art, name);
      button.addEventListener('click', () => picker.choose(p.id));
      return button;
    }),
  );
}

document.getElementById('install')!.addEventListener('click', () => picker.install());
picker.onChanged(() => void render());
void render();
