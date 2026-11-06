// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../src/core/content';
import { Rng } from '../../src/core/rng';
import { NewsFeed } from '../../src/ui/news';
import { Texts } from '../../src/ui/texts';

describe('новостная лента', () => {
  it('показывает все четыре последних заголовка', () => {
    const content = loadContent();
    const feed = new NewsFeed(new Texts(content.texts), new Rng(42));
    for (let i = 0; i < 8; i++) feed.push('tap');
    expect(feed.root.querySelectorAll('.news__item')).toHaveLength(4);
  });
});
