//! 后台预生成提交信息：AI Agent 写完代码、用户还没来提交的空档里先把提交信息生成好，点提交时直接用。
//! 前端按设置里的间隔（默认 30 秒）调一次；某项目的提示词连续两次一样（改动停了一个周期）才生成，没有改动不生成。
//! 缓存按「Agent + 提示词」的哈希命中，提示词里含语言和要提交的改动，改动一变就自然失效。
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

#[derive(Default)]
struct State {
    /// 上一次 tick 看到的哈希，用来判断改动是否停下
    last_seen: HashMap<String, u64>,
    /// 生成好的提交信息
    cached: HashMap<String, (u64, String)>,
    /// 正在后台生成的 (项目 id, 哈希)
    in_flight: Option<(String, u64)>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn with_state<R>(f: impl FnOnce(&mut State) -> R) -> R {
    f(STATE.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(State::default))
}

pub fn key(agent_id: &str, prompt: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    (agent_id, prompt).hash(&mut hasher);
    hasher.finish()
}

/// 记下本次看到的哈希；返回 true 表示改动已稳定且还没生成过，应该生成并标记为进行中
pub fn should_generate(id: &str, hash: u64) -> bool {
    with_state(|s| {
        let is_stable = s.last_seen.insert(id.to_string(), hash) == Some(hash);
        let is_cached = s.cached.get(id).is_some_and(|(h, _)| *h == hash);
        if !is_stable || is_cached || s.in_flight.is_some() {
            return false;
        }
        s.in_flight = Some((id.to_string(), hash));
        true
    })
}

/// 结束一次后台生成；失败时不缓存，下一个稳定周期会重试
pub fn finish(id: &str, hash: u64, message: Option<String>) {
    with_state(|s| {
        s.in_flight = None;
        if let Some(message) = message {
            s.cached.insert(id.to_string(), (hash, message));
        }
    });
}

/// 项目已经干净（提交过或改动被撤销），丢掉它的记录
pub fn forget(id: &str) {
    with_state(|s| {
        s.last_seen.remove(id);
        s.cached.remove(id);
    });
}

/// 取出命中的提交信息；同一份改动正在后台生成时等它生成完，不另起一个 Agent
pub fn take(id: &str, hash: u64) -> Option<String> {
    loop {
        let (hit, is_waiting) = with_state(|s| {
            let hit = s
                .cached
                .get(id)
                .filter(|(h, _)| *h == hash)
                .map(|(_, m)| m.clone());
            if hit.is_some() {
                s.cached.remove(id);
            }
            (hit, s.in_flight.as_ref() == Some(&(id.to_string(), hash)))
        });
        if hit.is_some() || !is_waiting {
            return hit;
        }
        thread::sleep(Duration::from_millis(200));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_only_after_stable_and_once() {
        let id = "prewarm-test";
        assert!(!should_generate(id, 1), "第一次看到不生成");
        assert!(!should_generate(id, 2), "改动还在变不生成");
        assert!(should_generate(id, 2), "连续两次一样才生成");
        assert!(!should_generate(id, 2), "进行中不重复生成");
        finish(id, 2, Some("feat: x".to_string()));
        assert!(!should_generate(id, 2), "已缓存不重复生成");
        assert_eq!(take(id, 3), None, "改动变了不命中");
        assert_eq!(take(id, 2).as_deref(), Some("feat: x"));
        assert_eq!(take(id, 2), None, "用过即删");
        forget(id);
    }
}
