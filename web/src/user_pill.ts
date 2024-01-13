import assert from "minimalistic-assert";

import render_input_pill from "../templates/input_pill.hbs";

import * as blueslip from "./blueslip";
import type {EmojiRenderingDetails} from "./emoji";
import * as group_permission_settings from "./group_permission_settings";
import type {InputPillConfig, InputPillContainer} from "./input_pill";
import * as input_pill from "./input_pill";
import type {User} from "./people";
import * as people from "./people";
import {realm} from "./state_data";
import type {
    CombinedPill,
    CombinedPillContainer,
    GroupSettingPillContainer,
} from "./typeahead_helper";
import * as user_status from "./user_status";

// This will be used for pills for things like composing
// direct messages or adding users to a stream/group.

export type UserPill = {
    type: "user";
    user_id?: number;
    email: string;
    full_name: string | undefined;
    img_src?: string;
    deactivated?: boolean;
    status_emoji_info?: (EmojiRenderingDetails & {emoji_alt_code?: boolean}) | undefined; // TODO: Move this in user_status.js
    should_add_guest_user_indicator?: boolean;
    user_is_bot?: boolean;
};

export type UserPillWidget = InputPillContainer<UserPill>;

export type UserPillData = {type: "user"; user: User};

export function create_item_from_email(
    email: string,
    current_items: CombinedPill[],
    pill_config?: InputPillConfig,
): UserPill | undefined {
    // For normal Zulip use, we need to validate the email for our realm.
    const user = people.get_by_email(email);

    if (!user) {
        if (realm.realm_is_zephyr_mirror_realm) {
            if (current_items.some((item) => item.type === "user" && item.email === email)) {
                return undefined;
            }

            // For Zephyr we can't assume any emails are invalid,
            // so we just create a pill where the display value
            // is the email itself.
            return {
                type: "user",
                full_name: undefined,
                email,
            };
        }

        // The email is not allowed, so return.
        return undefined;
    }

    if (pill_config?.exclude_inaccessible_users && user.is_inaccessible_user) {
        return undefined;
    }

    if (current_items.some((item) => item.type === "user" && item.user_id === user.user_id)) {
        return undefined;
    }

    const avatar_url = people.small_avatar_url_for_person(user);

    const status_emoji_info = user_status.get_status_emoji(user.user_id);

    const item: UserPill = {
        type: "user",
        full_name: user.full_name,
        user_id: user.user_id,
        email: user.email,
        img_src: avatar_url,
        deactivated: false,
        status_emoji_info,
        should_add_guest_user_indicator: people.should_add_guest_user_indicator(user.user_id),
        user_is_bot: user.is_bot,
    };

    // We pass deactivated true for a deactivated user
    //
    // We consider inaccessible users as active to avoid
    // falsely showing the user as deactivated as we do
    // not have any information about whether they are
    // active or not.
    if (!people.is_person_active(user.user_id) && !user.is_inaccessible_user) {
        item.deactivated = true;
    }

    return item;
}

export function get_email_from_item(item: UserPill): string {
    return item.email;
}

export function append_person(opts: {
    person: User;
    pill_widget: UserPillWidget | CombinedPillContainer | GroupSettingPillContainer;
}): void {
    const person = opts.person;
    const pill_widget = opts.pill_widget;
    const avatar_url = people.small_avatar_url_for_person(person);
    const status_emoji_info = user_status.get_status_emoji(opts.person.user_id);

    const pill_data: UserPill = {
        type: "user",
        full_name: person.full_name,
        user_id: person.user_id,
        email: person.email,
        img_src: avatar_url,
        status_emoji_info,
        should_add_guest_user_indicator: people.should_add_guest_user_indicator(person.user_id),
        user_is_bot: person.is_bot,
    };

    pill_widget.appendValidatedData(pill_data);
    pill_widget.clear_text();
}

export function get_user_ids(
    pill_widget: UserPillWidget | CombinedPillContainer | GroupSettingPillContainer,
): number[] {
    const items = pill_widget.items();
    return items.flatMap((item) => (item.type === "user" ? (item.user_id ?? []) : [])); // be defensive about undefined users
}

export function has_unconverted_data(pill_widget: UserPillWidget): boolean {
    // This returns true if we either have text that hasn't been
    // turned into pills or email-only pills (for Zephyr).
    if (pill_widget.is_pending()) {
        return true;
    }

    const items = pill_widget.items();
    const has_unknown_items = items.some((item) => item.user_id === undefined);

    return has_unknown_items;
}

export function typeahead_source(
    pill_widget: UserPillWidget | CombinedPillContainer | GroupSettingPillContainer,
    exclude_bots?: boolean,
    setting_name?: string,
    setting_type?: "realm" | "stream" | "group",
): UserPillData[] {
    let users = exclude_bots ? people.get_realm_active_human_users() : people.get_realm_users();
    if (setting_name !== undefined) {
        assert(setting_type !== undefined);
        const group_setting_config = group_permission_settings.get_group_permission_setting_config(
            setting_name,
            setting_type,
        );
        assert(group_setting_config !== undefined);
        if (!group_setting_config.allow_everyone_group) {
            users = users.filter((user) => !user.is_guest);
        }
    }
    return filter_taken_users(users, pill_widget).map((user) => ({type: "user", user}));
}

export function filter_taken_users(
    items: User[],
    pill_widget: UserPillWidget | CombinedPillContainer | GroupSettingPillContainer,
): User[] {
    const taken_user_ids = get_user_ids(pill_widget);
    items = items.filter((item) => !taken_user_ids.includes(item.user_id));
    return items;
}

export function append_user(
    user: User,
    pills: UserPillWidget | CombinedPillContainer | GroupSettingPillContainer,
): void {
    if (user) {
        append_person({
            pill_widget: pills,
            person: user,
        });
    } else {
        blueslip.warn("Undefined user in function append_user");
    }
}

export function get_display_value_from_item(item: UserPill): string {
    return item.full_name ?? item.email;
}

export function generate_pill_html(item: UserPill, show_user_status_emoji = false): string {
    let status_emoji_info;
    let has_status;
    if (show_user_status_emoji) {
        has_status = item.status_emoji_info !== undefined;
        if (has_status) {
            status_emoji_info = item.status_emoji_info;
        }
    }
    return render_input_pill({
        display_value: get_display_value_from_item(item),
        has_image: item.img_src !== undefined,
        deactivated: item.deactivated,
        should_add_guest_user_indicator: item.should_add_guest_user_indicator,
        user_id: item.user_id,
        img_src: item.img_src,
        has_status,
        status_emoji_info,
        user_is_bot: item.user_is_bot,
    });
}

export function create_pills(
    $pill_container: JQuery,
    pill_config?: InputPillConfig,
): input_pill.InputPillContainer<UserPill> {
    const pills = input_pill.create({
        $container: $pill_container,
        pill_config,
        create_item_from_text: create_item_from_email,
        get_text_from_item: get_email_from_item,
        get_display_value_from_item,
        generate_pill_html,
    });
    return pills;
}
