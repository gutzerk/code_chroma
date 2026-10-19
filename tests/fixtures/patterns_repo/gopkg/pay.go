package pay

import "sync"

type Charger interface {
	Charge(n int)
}

type Card struct{}

func (c *Card) Charge(n int) {}

type Cash struct{}

func (c *Cash) Charge(n int) {}

type Pool struct{}

var inst *Pool
var once sync.Once

func Get() *Pool {
	once.Do(func() { inst = &Pool{} })
	return inst
}

type Bus struct {
	subs     []func()
	handlers map[string]int
}

func (b *Bus) Add(f func()) { b.subs = append(b.subs, f) }

func (b *Bus) Fire() {
	for _, f := range b.subs {
		f()
	}
}

func (b *Bus) Set(k string, v int) { b.handlers[k] = v }
